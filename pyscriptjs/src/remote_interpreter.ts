import type { AppConfig } from './pyconfig';
import { getLogger } from './logger';
import { Stdio } from './stdio';
import { InstallError, ErrorCode } from './exceptions';
import { robustFetch } from './fetch';
import type { loadPyodide as loadPyodideDeclaration, PyodideInterface, PyProxy, PyProxyDict } from 'pyodide';
import type { ProxyMarked } from 'synclink';
import * as Synclink from 'synclink';

declare const loadPyodide: typeof loadPyodideDeclaration;
const logger = getLogger('pyscript/pyodide');

export type InterpreterInterface = (PyodideInterface & ProxyMarked) | null;

interface Micropip extends PyProxy {
    install(packageName: string | string[]): Promise<void>;
}

type FSInterface = {
    writeFile(path: string, data: Uint8Array | string, options?: { canOwn?: boolean; encoding?: string }): void;
    mkdirTree(path: string): void;
    mkdir(path: string): void;
} & ProxyMarked;

type PATHFSInterface = {
    resolve(path: string): string;
} & ProxyMarked;

type PATHInterface = {
    dirname(path: string): string;
} & ProxyMarked;

/*
RemoteInterpreter class is responsible to process requests from the
`InterpreterClient` class -- these can be requests for installation of
a package, executing code, etc.

Currently, the only interpreter available is Pyodide as indicated by the
`InterpreterInterface` type above. This serves as a Union of types of
different interpreters which will be added in near future.

Methods available handle loading of the interpreter, initialization,
running code, loading and installation of packages, loading from files etc.

The class will be turned `abstract` in future, to support more runtimes
such as MicroPython.
 */
export class RemoteInterpreter extends Object {
    src: string;
    interface: InterpreterInterface;
    FS: FSInterface;
    PATH: PATHInterface;
    PATH_FS: PATHFSInterface;

    globals: PyProxyDict & ProxyMarked;
    // TODO: Remove this once `runtimes` is removed!
    interpreter: InterpreterInterface & ProxyMarked;

    constructor(src = 'https://cdn.jsdelivr.net/pyodide/v0.22.1/full/pyodide.js') {
        super();
        this.src = src;
    }

    /**
     * loads the interface for the interpreter and saves an instance of it
     * in the `this.interface` property along with calling of other
     * additional convenience functions.
     * */

    /**
     * Although `loadPyodide` is used below,
     * notice that it is not imported i.e.
     * import { loadPyodide } from 'pyodide';
     * is not used at the top of this file.
     *
     * This is because, if it's used, loadPyodide
     * behaves mischievously i.e. it tries to load
     * `pyodide.asm.js` and `pyodide_py.tar` but
     * with paths that are wrong such as:
     *
     * http://127.0.0.1:8080/build/pyodide_py.tar
     * which results in a 404 since `build` doesn't
     * contain these files and is clearly the wrong
     * path.
     */
    async loadInterpreter(config: AppConfig, stdio: Stdio): Promise<void> {
        this.interface = Synclink.proxy(
            await loadPyodide({
                stdout: (msg: string) => {
                    // TODO: add syncify when moved to worker
                    stdio.stdout_writeline(msg);
                },
                stderr: (msg: string) => {
                    stdio.stderr_writeline(msg);
                },
                fullStdLib: false,
            }),
        );
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        this.FS = this.interface.FS;
        // eslint-disable-next-line
        this.PATH = (this.interface as any)._module.PATH;
        // eslint-disable-next-line
        this.PATH_FS = (this.interface as any)._module.PATH_FS;

        // TODO: Remove this once `runtimes` is removed!
        this.interpreter = this.interface;

        this.globals = Synclink.proxy(this.interface.globals as PyProxyDict);

        if (config.packages) {
            logger.info('Found packages in configuration to install. Loading micropip...');
            await this.loadPackage('micropip');
        }
        logger.info('pyodide loaded and initialized');
        await this.run('print("Python initialization complete")');
    }

    /* eslint-disable */
    async run(code: string): Promise<{ result: any }> {
        /**
         * eslint wants `await` keyword to be used i.e.
         * { result: await this.interface.runPython(code) }
         * However, `await` is not a no-op (no-operation) i.e.
         * `await 42` is NOT the same as `42` i.e. if the awaited
         * thing is not a promise, it is wrapped inside a promise and
         * that promise is awaited. Thus, it changes the execution order.
         * See https://stackoverflow.com/questions/55262996/does-awaiting-a-non-promise-have-any-detectable-effect
         * Thus, `eslint` is disabled for this block / snippet.
         */

        /**
         * The output of `runPython` is wrapped inside an object
         * since an object is not thennable and avoids return of
         * a coroutine directly. This is so we do not `await` the results
         * of the underlying python execution, even if it's an
         * awaitable object (Future, Task, etc.)
         */
        return { result: this.interface.runPython(code) };
    }
    /* eslint-enable */

    /**
     * delegates the registration of JS modules to
     * the underlying interface.
     * */
    registerJsModule(name: string, module: object): void {
        this.interface.registerJsModule(name, module);
    }

    /**
     * delegates the loading of packages to
     * the underlying interface.
     * */
    async loadPackage(names: string | string[]): Promise<void> {
        logger.info(`pyodide.loadPackage: ${names.toString()}`);
        // the new way in v0.22.1 is to pass it as a dict of options i.e.
        // { messageCallback: logger.info.bind(logger), errorCallback: logger.info.bind(logger) }
        // but one of our tests tries to use a locally downloaded older version of pyodide
        // for which the signature of `loadPackage` accepts the above params as args i.e.
        // the call uses `logger.info.bind(logger), logger.info.bind(logger)`.
        const messageCallback = logger.info.bind(logger) as typeof logger.info;
        if (this.interpreter.version.startsWith('0.22')) {
            await this.interface.loadPackage(names, {
                messageCallback,
                errorCallback: messageCallback,
            });
        } else {
            // @ts-expect-error Types don't include this deprecated call signature
            await this.interface.loadPackage(names, messageCallback, messageCallback);
        }
    }

    /**
     * delegates the installation of packages
     * (using a package manager, which can be specific to
     * the interface) to the underlying interface.
     *
     * For Pyodide, we use `micropip`
     * */
    async installPackage(package_name: string | string[]): Promise<void> {
        if (package_name.length > 0) {
            logger.info(`micropip install ${package_name.toString()}`);

            const micropip = this.interface.pyimport('micropip') as Micropip;
            try {
                await micropip.install(package_name);
                micropip.destroy();
            } catch (err) {
                const e = err as Error;
                let fmt_names: string;
                if (Array.isArray(package_name)) {
                    fmt_names = package_name.join(', ');
                } else {
                    fmt_names = package_name;
                }
                let exceptionMessage = `Unable to install package(s) '${fmt_names}'.`;

                // If we can't fetch `package_name` micropip.install throws a huge
                // Python traceback in `e.message` this logic is to handle the
                // error and throw a more sensible error message instead of the
                // huge traceback.
                if (e.message.includes("Can't find a pure Python 3 wheel")) {
                    exceptionMessage +=
                        ` Reason: Can't find a pure Python 3 Wheel for package(s) '${fmt_names}'.` +
                        `See: https://pyodide.org/en/stable/usage/faq.html#micropip-can-t-find-a-pure-python-wheel ` +
                        `for more information.`;
                } else if (e.message.includes("Can't fetch metadata")) {
                    exceptionMessage +=
                        ' Unable to find package in PyPI. ' +
                        'Please make sure you have entered a correct package name.';
                } else {
                    exceptionMessage +=
                        ` Reason: ${e.message}. Please open an issue at ` +
                        `https://github.com/pyscript/pyscript/issues/new if you require help or ` +
                        `you think it's a bug.`;
                }

                logger.error(e);

                throw new InstallError(ErrorCode.MICROPIP_INSTALL_ERROR, exceptionMessage);
            }
        }
    }

    /**
     *
     * @param path : the path in the filesystem
     * @param fetch_path : the path to be fetched
     *
     * Given a file available at `fetch_path` URL (eg:
     * `http://dummy.com/hi.py`), the function downloads the file and saves it
     * to the `path` (eg: `a/b/c/foo.py`) on the FS.
     *
     * Example usage: await loadFromFile(`a/b/c/foo.py`,
     * `http://dummy.com/hi.py`)
     *
     * Write content of `http://dummy.com/hi.py` to `a/b/c/foo.py`
     *
     * NOTE: The `path` parameter expects to have the `filename` in it i.e.
     * `a/b/c/foo.py` is valid while `a/b/c` (i.e. only the folders) are
     * incorrect.
     *
     * The path will be resolved relative to the current working directory,
     * which is initially `/home/pyodide`. So by default `a/b.py` will be placed
     * in `/home/pyodide/a/b.py`, `../a/b.py` will be placed into `/home/a/b.py`
     * and `/a/b.py` will be placed into `/a/b.py`.
     */
    async loadFromFile(path: string, fetch_path: string): Promise<void> {
        path = this.PATH_FS.resolve(path);
        const dir: string = this.PATH.dirname(path);
        this.FS.mkdirTree(dir);

        // `robustFetch` checks for failures in getting a response
        const response = await robustFetch(fetch_path);
        const buffer = await response.arrayBuffer();
        const data = new Uint8Array(buffer);

        this.FS.writeFile(path, data, { canOwn: true });
    }

    /**
     * delegates clearing importlib's module path
     * caches to the underlying interface
     */
    invalidate_module_path_cache(): void {
        const importlib = this.interface.pyimport('importlib') as PyProxy & { invalidate_caches(): void };
        importlib.invalidate_caches();
    }

    pyimport(mod_name: string): PyProxy & Synclink.ProxyMarked {
        return Synclink.proxy(this.interface.pyimport(mod_name));
    }

    mkdirTree(path: string) {
        this.FS.mkdirTree(path);
    }

    writeFile(path: string, content: string) {
        this.FS.writeFile(path, content, { encoding: 'utf8' });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    setHandler(func_name: string, handler: any): void {
        const pyscript_module = this.interface.pyimport('pyscript');
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        pyscript_module[func_name] = handler;
    }
}

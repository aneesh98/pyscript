import { describe, it, expect } from '@jest/globals';

describe('Placeholder', () => {
    it('this is a placeholder, we need to fix and re-enable the commented out tests', () => {
        expect(true).toBe(true);
    });
});

/*
describe('Test withUserErrorHandler', () => {
    class MyApp extends PyScriptApp {
        myRealMain: any;

        constructor(myRealMain) {
            super();
            this.myRealMain = myRealMain;
        }

        async _realMain() {
            await this.myRealMain();
        }
    }

    beforeEach(() => {
        // Ensure we always have a clean body
        document.body.innerHTML = `<div>Hello World</div>`;
    });

    it("userError doesn't stop execution", async () => {
        function myRealMain() {
            throw new UserError(ErrorCode.GENERIC, 'Computer says no');
        }

        const app = new MyApp(myRealMain);
        await app.main();
        const banners = document.getElementsByClassName('alert-banner');
        expect(banners.length).toBe(1);
        expect(banners[0].innerHTML).toBe('(PY0000): Computer says no');
    });

    it('userError escapes by default', async () => {
        function myRealMain() {
            throw new UserError(ErrorCode.GENERIC, 'hello <br>');
        }

        const app = new MyApp(myRealMain);
        await app.main();
        const banners = document.getElementsByClassName('alert-banner');
        expect(banners.length).toBe(1);
        expect(banners[0].innerHTML).toBe('(PY0000): hello &lt;br&gt;');
    });

    it("userError messageType=html don't escape", async () => {
        function myRealMain() {
            throw new UserError(ErrorCode.GENERIC, 'hello <br>', 'html');
        }

        const app = new MyApp(myRealMain);
        await app.main();
        const banners = document.getElementsByClassName('alert-banner');
        expect(banners.length).toBe(1);
        expect(banners[0].innerHTML).toBe('(PY0000): hello <br>');
    });

    it('any other exception should stop execution and raise', async () => {
        function myRealMain() {
            throw new Error('Explosions!');
        }

        const app = new MyApp(myRealMain);
        expect.assertions(1);
        await expect(async () => await app.main()).resolves.toThrow(new Error('Explosions!'));
    });
});
*/

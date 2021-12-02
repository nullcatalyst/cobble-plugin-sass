import * as assert from 'assert';
import { BuildSettings } from 'cobble/lib/composer/settings';
import { ResolvedPath } from 'cobble/lib/util/resolved_path';
import { Event, EventType } from 'cobble/lib/watcher/event';
import { FakeWatcher } from 'cobble/lib/watcher/fake';
import * as fs from 'fs';
import * as tmp from 'tmp-promise';
import { SassPlugin } from '../sass';


describe('sass plugin', () => {
    const defer: (() => void)[] = [];
    afterEach(() => {
        defer.forEach(f => f());
        defer.length = 0;
    });

    it('should clean up after itself', async () => {
        const { path: dirPath, cleanup: dirCleanup } = await tmp.dir({ unsafeCleanup: true });
        defer.push(dirCleanup);

        const basePath = ResolvedPath.absolute(dirPath);
        const filePath1 = basePath.join('1.scss');
        await fs.promises.writeFile(filePath1.toString(), 'h1 { color: red; }');
        const filePath2 = basePath.join('2.scss');
        await fs.promises.writeFile(filePath2.toString(), 'h2 { color: blue; }');

        const watcher = new FakeWatcher();
        const plugin = new SassPlugin({});
        const settings = new BuildSettings('linux');
        await settings.load(
            {
                'name': 'test',
                'srcs': [`${plugin.name()}:${filePath1.toString()}`, `${plugin.name()}:${filePath2.toString()}`],
            },
            basePath.join('build.json'),
        );

        const cleanup = await plugin.process(watcher, settings);
        assert.strictEqual(watcher.callbacks.size, 2);
        cleanup();
        assert.strictEqual(watcher.callbacks.size, 0);
    });

    it('should find other imports', async () => {
        const { path: dirPath, cleanup: dirCleanup } = await tmp.dir({ unsafeCleanup: true });
        defer.push(dirCleanup);

        const basePath = ResolvedPath.absolute(dirPath);
        const filePath1 = basePath.join('1.scss');
        await fs.promises.writeFile(filePath1.toString(), '@import "./2"; h1 { color: red; }');
        const filePath2 = basePath.join('2.scss');
        await fs.promises.writeFile(filePath2.toString(), 'h2 { color: blue; }');

        const watcher = new FakeWatcher();
        const plugin = new SassPlugin({});
        const settings = new BuildSettings('linux');
        await settings.load(
            {
                'name': 'test',
                'srcs': [`${plugin.name()}:${filePath1.toString()}`],
            },
            basePath.join('build.json'),
        );

        const cleanup = await plugin.process(watcher, settings);
        assert.strictEqual(watcher.callbacks.size, 2);
        cleanup();
        assert.strictEqual(watcher.callbacks.size, 0);
    });

    it('should stop watching files that are no longer used', async () => {
        const { path: dirPath, cleanup: dirCleanup } = await tmp.dir({ unsafeCleanup: true });
        defer.push(dirCleanup);

        const basePath = ResolvedPath.absolute(dirPath);
        const filePath1 = basePath.join('1.scss');
        await fs.promises.writeFile(filePath1.toString(), '@import "./2"; h1 { color: red; }');
        const filePath2 = basePath.join('2.scss');
        await fs.promises.writeFile(filePath2.toString(), 'h2 { color: blue; }');

        const watcher = new FakeWatcher();
        const plugin = new SassPlugin({});
        const settings = new BuildSettings('linux');
        await settings.load(
            {
                'name': 'test',
                'srcs': [`${plugin.name()}:${filePath1.toString()}`],
            },
            basePath.join('build.json'),
        );

        // First build
        const cleanup = await plugin.process(watcher, settings);
        assert.strictEqual(watcher.callbacks.size, 2);

        // Change file and rebuild
        await fs.promises.writeFile(filePath1.toString(), 'h1 { color: green; }');
        await watcher.emit(new Event(EventType.ChangeFile, filePath1));
        assert.strictEqual(watcher.callbacks.size, 1);

        // Cleanup
        cleanup();
        assert.strictEqual(watcher.callbacks.size, 0);
    });
});

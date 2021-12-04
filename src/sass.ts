import * as cobble from 'cobble';
import * as fs from 'fs';
import * as sass from 'node-sass';

export class SassPlugin extends cobble.BasePlugin {
    override name(): string {
        return 'sass';
    }

    override provideProtocolExtensions(): string[] {
        return ['scss', 'sass'];
    }

    override async process(
        watcher: cobble.BaseWatcher,
        settings: cobble.BuildSettings,
    ): Promise<cobble.ResetPluginWatchedFilesFn> {
        const srcs = this.filterSrcs(settings);
        if (srcs.length == 0) {
            return () => {};
        }
        const inputContents = srcs
            .map(src => `@import "./${settings.basePath.relative(src.path).replaceAll('\\', '/')}";\n`)
            .join('');

        const watchedFiles: { [filePath: string]: () => void } = {};
        const build = cobble.createMailbox(async () => {
            // Make a copy of the previous watched files
            // This will be used to determine whether new files are being watched, as well as to stop watching unused files
            const prevWatchFiles = Object.assign({}, watchedFiles);

            const result = await new Promise<sass.Result>((resolve, reject) => {
                // Note: node-sass must be used over dart-sass because dart-sass short-circuits and avoids the importer if it sees that the import is a file
                // This means we won't know if the file is being used to watch for it
                sass.render(
                    {
                        data: inputContents,
                        outputStyle: /*release*/ false ? 'compressed' : 'expanded',
                        importer: (fileName: string, prev: string) => {
                            const prevPath =
                                prev === 'stdin' ? settings.basePath : cobble.ResolvedPath.absolute(prev).dirname();
                            const filePath = prevPath.join(fileName);
                            if (filePath.toString() in watchedFiles) {
                                // This file is already being watched and is still being used, don't remove it from the list
                                delete prevWatchFiles[filePath.toString()];
                            } else {
                                // Start watching a new file
                                const cleanup = watcher.add(filePath, build);
                                watchedFiles[filePath.toString()] = cleanup;
                            }
                            return { file: filePath.toString() };
                        },
                    },
                    (err, result) => {
                        if (err != null) {
                            reject(err);
                            return;
                        }

                        for (const [filePath, cleanup] of Object.entries(prevWatchFiles)) {
                            delete watchedFiles[filePath.toString()];
                            cleanup();
                        }

                        resolve(result);
                    },
                );
            });

            await fs.promises.writeFile(settings.outDir.join(`${settings.name}.css`).toString(), result.css);
        });

        // Trigger the first build in order to find the files to watch (the actual event doesn't matter)
        await build(new cobble.Event(cobble.EventType.AddFile, settings.outDir));

        return async () => {
            for (const [filePath, cleanup] of Object.entries(watchedFiles)) {
                cleanup();
            }
        };
    }
}

import { BuildSettings } from 'cobble/lib/composer/settings';
import { BasePlugin, ResetPluginWatchedFilesFn } from 'cobble/lib/plugins/base';
import { createMailbox } from 'cobble/lib/util/mailbox';
import { ResolvedPath } from 'cobble/lib/util/resolved_path';
import { BaseWatcher } from 'cobble/lib/watcher/base';
import { Event, EventType } from 'cobble/lib/watcher/event';
import * as fs from 'fs';
import * as sass from 'node-sass';

export class SassPlugin extends BasePlugin {
    constructor(opts?: any) {
        super(opts);
    }

    override name(): string {
        return 'sass';
    }

    override provideProtocolExtensions(): string[] {
        return ['scss', 'sass'];
    }

    override async process(watcher: BaseWatcher, settings: BuildSettings): Promise<ResetPluginWatchedFilesFn> {
        const srcs = settings.srcs.filter(src => src.protocol == this.name());
        const inputContents = srcs
            .map(src => `@import "./${settings.basePath.relative(src.path).replaceAll('\\', '/')}";\n`)
            .join('');
        const inputName = '__virtual__';

        const watchedFiles: { [filePath: string]: () => void } = {};
        const build = createMailbox(async () => {
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
                                prev === 'stdin' ? settings.basePath : ResolvedPath.absolute(prev).dirname();
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

            await fs.promises.writeFile(settings.outputPath.toString(), result.css);
        });

        // Trigger the first build in order to find the files to watch (the actual event doesn't matter)
        await build(new Event(EventType.AddFile, settings.outputPath));

        return async () => {
            for (const [filePath, cleanup] of Object.entries(watchedFiles)) {
                cleanup();
            }
        };
    }
}

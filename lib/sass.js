"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SassPlugin = void 0;
const base_1 = require("cobble/lib/plugins/base");
const mailbox_1 = require("cobble/lib/util/mailbox");
const resolved_path_1 = require("cobble/lib/util/resolved_path");
const event_1 = require("cobble/lib/watcher/event");
const fs = __importStar(require("fs"));
const sass = __importStar(require("node-sass"));
class SassPlugin extends base_1.BasePlugin {
    constructor(opts) {
        super(opts);
    }
    name() {
        return 'sass';
    }
    provideProtocolExtensions() {
        return ['scss', 'sass'];
    }
    async process(watcher, settings) {
        const srcs = settings.srcs.filter(src => src.protocol == this.name());
        const inputContents = srcs
            .map(src => `@import "./${settings.basePath.relative(src.path).replaceAll('\\', '/')}";\n`)
            .join('');
        const inputName = '__virtual__';
        const watchedFiles = {};
        const build = (0, mailbox_1.createMailbox)(async () => {
            // Make a copy of the previous watched files
            // This will be used to determine whether new files are being watched, as well as to stop watching unused files
            const prevWatchFiles = Object.assign({}, watchedFiles);
            const result = await new Promise((resolve, reject) => {
                // Note: node-sass must be used over dart-sass because dart-sass short-circuits and avoids the importer if it sees that the import is a file
                // This means we won't know if the file is being used to watch for it
                sass.render({
                    data: inputContents,
                    outputStyle: /*release*/ false ? 'compressed' : 'expanded',
                    importer: (fileName, prev) => {
                        const prevPath = prev === 'stdin' ? settings.basePath : resolved_path_1.ResolvedPath.absolute(prev).dirname();
                        const filePath = prevPath.join(fileName);
                        if (filePath.toString() in watchedFiles) {
                            // This file is already being watched and is still being used, don't remove it from the list
                            delete prevWatchFiles[filePath.toString()];
                        }
                        else {
                            // Start watching a new file
                            const cleanup = watcher.add(filePath, build);
                            watchedFiles[filePath.toString()] = cleanup;
                        }
                        return { file: filePath.toString() };
                    },
                }, (err, result) => {
                    if (err != null) {
                        reject(err);
                        return;
                    }
                    for (const [filePath, cleanup] of Object.entries(prevWatchFiles)) {
                        delete watchedFiles[filePath.toString()];
                        cleanup();
                    }
                    resolve(result);
                });
            });
            await fs.promises.writeFile(settings.outputPath.toString(), result.css);
        });
        // Trigger the first build in order to find the files to watch (the actual event doesn't matter)
        await build(new event_1.Event(event_1.EventType.AddFile, settings.outputPath));
        return async () => {
            for (const [filePath, cleanup] of Object.entries(watchedFiles)) {
                cleanup();
            }
        };
    }
}
exports.SassPlugin = SassPlugin;
//# sourceMappingURL=sass.js.map
import { exec as cpExec } from 'node:child_process';
import { lstat, readFile, readdir, rmdir, unlink, writeFile } from 'node:fs/promises';
import https from 'node:https';
import { basename, dirname, join as pathJoin } from 'node:path';
import readline from 'node:readline';
import { promisify } from 'node:util';

let packageManager = '';

/**
 * configures a package created from the template.
 */
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
});

const exec = promisify(cpExec);
const question = promisify(rl.question).bind(rl);

const packageInfo = {
    name: '',
    packageManager: 'npm',
    description: '',
    vendor: {
        github: '',
        name: '',
    },
    author: {
        email: '',
        github: '',
        name: '',
    },
};

const ANSI_BRIGHT_BLUE = '\x1b[94m';
const ANSI_BRIGHT_GREEN = '\x1b[92m';
const ANSI_BRIGHT_RED = '\x1b[91m';
const ANSI_BRIGHT_WHITE = '\x1b[97m';
const ANSI_BRIGHT_YELLOW = '\x1b[93m';
const ANSI_RESET = '\x1b[0m';

const colorString = (str, color) => color + str + ANSI_RESET;
const blue = str => colorString(str, ANSI_BRIGHT_BLUE);
const green = str => colorString(str, ANSI_BRIGHT_GREEN);
const red = str => colorString(str, ANSI_BRIGHT_RED);
const white = str => colorString(str, ANSI_BRIGHT_WHITE);
const yellow = str => colorString(str, ANSI_BRIGHT_YELLOW);

class Stdout {
    write(text) {
        process.stdout.write(text);
    }
    writeln(text) {
        this.write(`${text}\n`);
    }
}

const stdout = new Stdout();

const exists = async path => {
    try {
        await lstat(path);
        return true;
    } catch (e) {
        return false;
    }
};

const thisFile = () => import.meta.url.replace('file://', '');
const thisDir = () => dirname(import.meta.url.replace('file://', ''));
const runCommand = async str => await exec(str, { cwd: thisDir(), encoding: 'utf-8', stdio: 'inherit' });
const gitCommand = async command => {
    try {
        const result = (await exec(`git ${command}`, { env: process.env, cwd: thisDir(), encoding: 'utf-8', stdio: 'pipe' })) || '';
        return result.stdout;
    } catch (err) {
        return '';
    }
};
const safeUnlink = async path => (await exists(path)) && (await unlink(path));
const getWorkflowFilename = name => `${thisDir()}/.github/workflows/${name}.yml`;
const getGithubConfigFilename = name => `${thisDir()}/.github/${name}.yml`;
const writeFormattedJson = async (filename, data) => await writeFile(filename, JSON.stringify(data, null, 4), { encoding: 'utf-8' });
const isAnswerYes = answer => answer.toLowerCase().trim().startsWith('y');
const isAnswerNo = answer => answer.toLowerCase().trim().startsWith('n');

/**
 * determine if a path is a directory.
 * @param {string} path
 * @returns {boolean} true if the path is a directory, false otherwise
 */
async function is_dir(path) {
    try {
        const pathStat = await lstat(path);
        return pathStat.isDirectory();
    } catch (e) {
        return false;
    }
}

/**
 * determine if a path is a file.
 * @param {string} path
 * @returns {boolean} true if the path is a file, false otherwise
 */
async function is_file(path) {
    try {
        const pathStat = await lstat(path);
        return pathStat.isFile(); //|| pathStat.isSymbolicLink();
    } catch (e) {
        return false;
    }
}

/**
 * prompt the user to answer a question, returning defaultValue if no answer is given.
 * @param {string} prompt
 * @param {string} defaultValue
 * @returns string
 */
const askQuestion = async (prompt, defaultValue = '') => {
    let result = '';

    try {
        result = await question(`» ${prompt} ${defaultValue.length ? '(' + defaultValue + ') ' : ''}`);
    } catch (err) {
        result = false;
    }

    return new Promise(resolve => {
        if (!result || result.trim().length === 0) {
            result = defaultValue;
        }

        resolve(result);
    });
};

/**
 * ask a yes or no question
 * @param {string} str
 * @param {boolean} defaultAnswer
 * @returns {boolean} true or false
 */
const askBooleanQuestion = async (str, defaultAnswer = true) => {
    const suffix = defaultAnswer ? '[Y/n]' : '[y/N]';
    const resultStr = (await askQuestion(`${str} ${suffix} `)).toString().trim();

    if (!resultStr.length) {
        return defaultAnswer;
    }

    return isAnswerYes(resultStr);
};

/**
 * conditionally ask a question based on the value of a property in an object, and update the object's property value.
 * @param {object} obj
 * @param {string} propName
 * @param {boolean} onlyEmpty
 * @param {string} prompt
 * @param {boolean} allowEmpty
 * @param {boolean} alwaysAsk
 * @returns void
 */
const conditionalAsk = async (obj, propName, onlyEmpty, prompt, allowEmpty = false, alwaysAsk = true) => {
    const value = obj[propName] || '';

    if (!onlyEmpty || !value.length || alwaysAsk) {
        while (!obj[propName] || obj[propName]?.length === 0 || alwaysAsk) {
            obj[propName] = await askQuestion(prompt, value);

            if (allowEmpty && obj[propName]?.length === 0) {
                break;
            }

            if (obj[propName]?.length > 0) {
                break;
            }
        }
    }

    return new Promise(resolve => resolve());
};

/**
 * get a github api endpoint and return the response.
 * @param {string} endpoint
 */
async function getGithubApiEndpoint(endpoint) {
    const url = `https://api.github.com/${endpoint}`.replace('//', '/');

    const requestJson = async url => {
        const options = {
            headers: {
                'User-Agent': 'permafrost-dev-template-configure/1.0',
                Accept: 'application/json, */*',
            },
        };

        return new Promise((resolve, reject) => {
            const req = https.get(url, options);

            req.on('response', async res => {
                let body = '';
                res.setEncoding('utf-8');

                for await (const chunk of res) {
                    body += chunk;
                }

                resolve(JSON.parse(body));
            });

            req.on('error', err => {
                throw new err();
            });
        });
    };

    const response = {
        exists: true,
        data: {},
    };

    try {
        response.data = await requestJson(url);
        response.exists = true;
    } catch (e) {
        response.exists = false;
        response.data = {};
    }

    if (response.exists && response.data['message'] === 'Not Found') {
        response.exists = false;
        response.data = {};
    }

    return response;
}

async function getGithubUsernameFromGitRemote() {
    const remoteUrlParts = (await gitCommand('config remote.origin.url')).trim().replace(':', '/').split('/');
    return remoteUrlParts[1];
}

async function searchCommitsForGithubUsername() {
    const authorName = (await gitCommand('config user.name')).trim().toLowerCase();

    const committers = (await gitCommand(`log --author='@users.noreply.github.com'  --pretty='%an:%ae' --reverse`))
        .split('\n')
        .map(line => line.trim())
        .map(line => ({ name: line.split(':')[0], email: line.split(':')[1] }))
        .filter(item => !item.name.includes('[bot]'))
        .filter(item => item.name.toLowerCase().localeCompare(authorName.toLowerCase()) === 0);

    if (!committers.length) {
        return '';
    }

    return committers[0].email.split('@')[0];
}

/**
 * try to guess the current user's github username.
 * @returns {string} the github username
 */
async function guessGithubUsername() {
    const username = await searchCommitsForGithubUsername();

    if (username.length) return username;

    return await getGithubUsernameFromGitRemote();
}

/**
 * Removes the template README text from the README.md file
 */
async function removeTemplateReadmeText() {
    const END_BLOCK_STR = '<!-- ==END TEMPLATE README== -->';
    const START_BLOCK_STR = '<!-- ==START TEMPLATE README== -->';

    const content = await readFile(`${thisDir()}/README.md`).toString();

    if (content.includes(START_BLOCK_STR) && content.includes(END_BLOCK_STR)) {
        const startBlockPos = content.indexOf(START_BLOCK_STR);
        const endBlockPos = content.lastIndexOf(END_BLOCK_STR);

        const newContent = content.replace(content.substring(startBlockPos, endBlockPos + END_BLOCK_STR.length), '');

        if (newContent.length) {
            await writeFile(`${thisDir()}/README.md`, newContent);
        }
    }
}

async function removeAssetsDirectory() {
    try {
        await removeDirectory(`${thisDir()}/assets`);
    } catch (e) {
        //
    }
}

/**
 * recursively remove a directory
 * @param {string} src
 * @returns void
 */
async function removeDirectory(src, level = 0) {
    const srcExists = await exists(src);
    if (!srcExists) {
        return;
    }

    const srcStat = await lstat(src);
    const files = await readdir(src);

    if (files.length === 0 && srcStat.isDirectory()) {
        await rmdir(src);
        return;
    }

    for (const file of files) {
        const filePath = pathJoin(src, file);
        const fileStat = await lstat(filePath);

        if (fileStat.isDirectory()) {
            // Recursively remove directories
            await removeDirectory(filePath, ++level);
            level--;
        } else {
            await unlink(filePath);
        }
    }

    try {
        if (srcStat.isDirectory() && level > -1) {
            await rmdir(src);
        }
    } catch (e) {
        //
    }
}

const replaceVariablesInFile = async (filename, packageInfo, wl) => {
    let content = await readFile(filename, { encoding: 'utf-8' }).toString();
    const originalContent = content.slice();

    content = content
        .replaceAll('package-skeleton', packageInfo.name)
        .replaceAll('{{vendor.name}}', packageInfo.vendor.name)
        .replaceAll('{{vendor.github}}', packageInfo.vendor.github)
        .replaceAll('{{package.name}}', packageInfo.name)
        .replaceAll('{{package.description}}', packageInfo.description)
        .replaceAll('{{package.author.name}}', packageInfo.author.name)
        .replaceAll('{{package.author.email}}', packageInfo.author.email)
        .replaceAll('{{package.author.github}}', packageInfo.author.github)
        .replaceAll('{{date.year}}', new Date().getFullYear())
        .replace('Template Setup: run `node configure-package.js` to configure.\n', '');

    if (originalContent !== content) {
        await writeFile(filename, content, { encoding: 'utf-8' });
    }

    const relativeName = filename.replace(`${thisDir()}/`, '');
    stdout.writeln(`${green('»')} processed ${white(relativeName)} ${green('✓')}`);
};

const filesToProcess = [];

const preprocessFiles = async directory => {
    const filelist = await readdir(directory, { encoding: 'utf8', withFileTypes: false, recursive: true });

    const files = filelist
        .filter(f => {
            return (
                !f.includes('node_modules') &&
                !f.includes('.git') &&
                ![
                    '..',
                    '.git',
                    'assets',
                    'build.js',
                    'configure-package.js',
                    'node_modules',
                    'bun.lockb',
                    'package-lock.json',
                    'prettier.config.cjs',
                ].includes(basename(f))
            );
        })
        .filter(f => !f.includes('lock') && !f.includes('.log') && !f.includes('dist/'))
        .filter(f => f.endsWith('.json') || f.endsWith('.md') || f.endsWith('.yml') || f.endsWith('.js') || f.endsWith('.ts') || f.endsWith('.cjs'));

    for (const idx in files) {
        const fn = files[idx];
        const fqName = `${directory}/${fn}`;

        const relativeName = fqName.replace(`${thisDir()}/`, '');
        const isPath = await is_dir(fqName);
        const isFile = await is_file(fqName);

        console.log(`» found ${isPath ? 'directory' : 'file'} ./${relativeName}...\n`);

        if (isFile) {
            try {
                filesToProcess.push(fqName);
            } catch (err) {
                // stdout.write(yellow(`failed`));
            } finally {
                // stdout.writeln('');
            }
        }
    }
};

const processFiles = async directory => {
    await preprocessFiles(directory);
    await Promise.allSettled(filesToProcess.map(fn => replaceVariablesInFile(fn, packageInfo, stdout.writeln)));
};

const populatePackageInfo = async (onlyEmpty = false) => {
    const remoteUrlParts = (await gitCommand('config remote.origin.url')).trim().replace(':', '/').split('/');

    console.log();

    packageInfo.name = basename(thisDir());
    packageInfo.author.name = (await gitCommand('config user.name')).trim();
    packageInfo.author.email = (await gitCommand('config user.email')).trim();
    packageInfo.vendor.name = packageInfo.author.name;
    packageInfo.author.github = await guessGithubUsername();
    packageInfo.vendor.github = remoteUrlParts[1] || '';

    // check if the guessed vendor is a github org, and if so, use the org name
    const orgResponse = await getGithubApiEndpoint(`orgs/${packageInfo.vendor.github}`);
    if (orgResponse.exists) {
        packageInfo.vendor.name = orgResponse.data.name ?? orgResponse.data.login;
    }

    await conditionalAsk(packageInfo, 'name', onlyEmpty, 'package name?', false);
    await conditionalAsk(packageInfo, 'description', onlyEmpty, 'package description?');
    await conditionalAsk(packageInfo.author, 'name', onlyEmpty, 'author name?');
    await conditionalAsk(packageInfo.author, 'email', onlyEmpty, 'author email?');
    await conditionalAsk(packageInfo.author, 'github', onlyEmpty, 'author github username?');
    await conditionalAsk(packageInfo.vendor, 'name', onlyEmpty, 'vendor name (default is author name)?', true);
    await conditionalAsk(packageInfo.vendor, 'github', onlyEmpty, 'vendor github org/user name (default is author github)?', true);

    if (packageInfo.vendor.name.length === 0) {
        packageInfo.vendor.name = packageInfo.author.name;
    }

    if (packageInfo.vendor.github.length === 0) {
        packageInfo.vendor.github = packageInfo.author.github;
    }
};

class PackageFile {
    pkg = {};

    constructor() {
        this.pkg = {};
    }
    async load() {
        const json = await readFile(`${thisDir()}/package.json`, { encoding: 'utf-8' });
        this.pkg = JSON.parse(json);
        return this;
    }
    async save() {
        await writeFormattedJson(`${thisDir()}/package.json`, this.pkg);
        return this;
    }
    static async make() {
        const result = new PackageFile();
        await result.load();

        return result;
    }
    addScript(name, script) {
        this.pkg.scripts[name] = script;
        return this;
    }
    replaceScript(name, script) {
        this.pkg.scripts[name] = script;
        return this;
    }
    deleteScripts(...names) {
        for (const name of names) {
            if (typeof this.pkg.scripts[name] !== 'undefined') {
                delete this.pkg.scripts[name];
            }
        }
        return this;
    }
    filterScripts1(name) {
        if (typeof this.pkg.scripts[name] !== 'undefined') {
            delete this.pkg.scripts[name];
        }
        for (const key of Object.keys(this.pkg.scripts)) {
            if (this.pkg.scripts[key].includes(name)) {
                delete this.pkg.scripts[key];
            }
        }
        return this;
    }
    filterScripts(name) {
        const regex1 = new RegExp(`(&&\\s+)${name.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}.*`, 'g');
        const regex2 = new RegExp(`^${name.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}.*`, 'g');

        for (const key in this.pkg.scripts) {
            this.pkg.scripts[key] = this.pkg.scripts[key].replace(regex1, ' $2').trim();
            this.pkg.scripts[key] = this.pkg.scripts[key].replace(regex2, '').trim();
            this.pkg.scripts[key] = this.pkg.scripts[key]
                .split('&&')
                .filter(cmd => !cmd.includes(name))
                .join('&&');
            if (this.pkg.scripts[key].length === 0) {
                delete this.pkg.scripts[key];
            }
        }

        return this;
    }
    delete(...keys) {
        for (const key of keys) {
            if (typeof this.pkg[key] !== 'undefined') {
                delete this.pkg[key];
            }
        }
        return this;
    }
    removeDependencies(...keys) {
        if (typeof this.pkg.dependencies !== 'undefined') {
            for (const key of keys) {
                if (typeof this.pkg.dependencies[key] !== 'undefined') {
                    delete this.pkg.dependencies[key];
                }
            }
        }
        for (const key of keys) {
            if (typeof this.pkg.devDependencies[key] !== 'undefined') {
                delete this.pkg.devDependencies[key];
            }
        }
        return this;
    }
    filterLintStaged(cmd) {
        if (typeof this.pkg['lint-staged'] === 'undefined') {
            return this;
        }

        for (const key of Object.keys(this.pkg['lint-staged'])) {
            this.pkg['lint-staged'][key] = this.pkg['lint-staged'][key].filter(c => !c.includes(cmd));
        }

        return this;
    }
}

class FileRemover {
    files = [];
    constructor() {
        this.files = [];
    }
    add(...filenames) {
        for (const filename of filenames) {
            const fn = filename.replace(`${thisDir()}/`, '');
            this.files.push(`${thisDir()}/${fn}`);
        }
        return this;
    }
    async remove() {
        for (const filename of this.files) {
            await safeUnlink(filename);
        }
        this.files = [];
    }
}

class CallbackQueue {
    queue = [];
    constructor() {
        this.queue = [];
    }
    add(...funcs) {
        this.queue.push(...funcs);
        return this;
    }
    async run() {
        while (this.queue.length > 0) {
            const cb = this.queue.shift();
            await cb();
        }
    }
}

class Features {
    codecov = {
        name: 'codecov',
        prompt: 'Use code coverage service codecov?',
        enabled: true,
        dependsOn: [],
        disable: async ({ remover, cbqueue }) => {
            cbqueue.add(async () => {
                const fn = getWorkflowFilename('run-tests');
                const contents = await readFile(fn, 'utf-8');
                await writeFile(fn, contents.replace('USE_CODECOV_SERVICE: yes', 'USE_CODECOV_SERVICE: no'), 'utf-8');
            });

            remover.add(getGithubConfigFilename('codecov'));
        },
    };

    autoformat = {
        name: 'autoformat',
        prompt: 'Automatically lint & format code on push?',
        enabled: true,
        default: true,
        dependsOn: [],
        disable: async ({ remover }) => {
            remover.add(getWorkflowFilename('format-code'));
        },
    };

    dependabot = {
        name: 'dependabot',
        prompt: 'Use Dependabot?',
        enabled: true,
        default: true,
        dependsOn: [],
        disable: async ({ remover }) => {
            remover.add(getGithubConfigFilename('dependabot'));
            await this.automerge.disable();
            this.automerge.enabled = false;
        },
    };

    automerge = {
        name: 'automerge',
        prompt: 'Automerge Dependabot PRs?',
        enabled: true,
        default: true,
        dependsOn: ['dependabot'],
        disable: async ({ remover }) => {
            remover.add(getWorkflowFilename('dependabot-auto-merge'));
        },
    };

    codeql = {
        name: 'codeql',
        prompt: 'Use CodeQL Quality Analysis?',
        enabled: true,
        default: true,
        dependsOn: [],
        disable: async ({ remover }) => {
            remover.add(getWorkflowFilename('codeql-analysis'));
        },
    };

    updateChangelog = {
        name: 'updateChangelog',
        prompt: 'Use Changelog Updater Workflow?',
        enabled: true,
        dependsOn: [],
        disable: async ({ remover }) => {
            await remover.add(getWorkflowFilename('update-changelog'));
        },
    };

    useMadgePackage = {
        name: 'useMadgePackage',
        prompt: 'Use madge package for code analysis?',
        enabled: true,
        dependsOn: [],
        disable: async ({ pkg, remover }) => {
            pkg.removeDependencies('madge');
            pkg.filterScripts('madge');
            remover.add(`${thisDir()}/.madgerc`);
        },
    };

    useVitestPackage = {
        name: 'useVitestPackage',
        prompt: 'Use vitest for js/ts unit testing?',
        enabled: true,
        default: true,
        dependsOn: [],
        disable: async ({ pkg }) => {
            pkg.removeDependencies('vitest', '@vitest/coverage-v8');
            pkg.replaceScript('test', 'echo "no tests defined" && exit 0');
        },
    };

    useEslintPackage = {
        name: 'useEslintPackage',
        prompt: 'Use ESLint for js/ts code linting?',
        enabled: true,
        default: true,
        dependsOn: [],
        disable: async ({ pkg, remover }) => {
            pkg.removeDependencies('eslint', 'eslint-plugin-node', '@typescript-eslint/eslint-plugin', '@typescript-eslint/parser');
            pkg.filterScripts('eslint');
            pkg.filterLintStaged('eslint');
            remover.add('.eslintrc.cjs', '.eslintignore');
        },
    };

    useBiomePackage = {
        name: 'useBiomePackage',
        prompt: 'Use biome for js/ts code linting/formatting?',
        enabled: true,
        default: true,
        dependsOn: [],
        disable: async ({ pkg, remover }) => {
            pkg.removeDependencies('@biomejs/biome');
            pkg.filterScripts('biome');
            pkg.filterLintStaged('biome');

            remover.add('biome.json');
        },
    };

    useTypedocPackage = {
        name: 'useTypedocPackage',
        prompt: 'Use typedoc to generate api docs?',
        enabled: true,
        default: true,
        dependsOn: [],
        disable: async ({ pkg }) => {
            pkg.removeDependencies('typedoc', 'typedoc-plugin-markdown');
            pkg.filterScripts('typedoc');
        },
    };

    features = [
        this.codecov,
        this.autoformat,
        this.dependabot,
        this.automerge,
        this.codeql,
        this.updateChangelog,
        this.useMadgePackage,
        this.useVitestPackage,
        this.useEslintPackage,
        this.useBiomePackage,
        this.useTypedocPackage,
    ];

    async run(pkg, remover, cbqueue) {
        const state = {};

        for (const feature of this.features) {
            if (feature.dependsOn.length > 0) {
                const dependencies = feature.dependsOn.map(dep => state[dep]);

                feature.enabled = dependencies.every(dep => dep);
            }

            if (feature.enabled) {
                feature.enabled = await askBooleanQuestion(feature.prompt, feature.default);
            }

            state[feature.name] = feature.enabled;

            if (!feature.enabled) {
                feature.disable({ pkg, remover, cbqueue });
            }
        }
    }
}

const lintAndFormatSourceFiles = async () => {
    await exec(`${packageManager} run fix`, { cwd: thisDir(), stdio: 'inherit' });
};

async function getPackageManager() {
    const managerMap = {
        bun: 'bun.lockb',
        yarn: 'yarn.lock',
        npm: 'package-lock.json',
    };

    for (const [name, fn] in Object.entries(managerMap)) {
        if (await exists(`${thisDir()}/${managerMap[fn]}`)) {
            return name;
        }
    }

    return 'npm';
}

async function promptForPackageManager() {
    const names = ['npm', 'yarn', 'bun', 'pnpm'];

    names.sort();

    const defaultName = await getPackageManager();

    packageInfo.packageManager = '';

    while (!names.includes(packageInfo.packageManager)) {
        if (packageInfo.packageManager.length > 0) {
            stdout.writeln(yellow(`» Invalid package manager, accepted values:${names.join(', ')}.`));
            packageInfo.packageManager = '';
        }
        if (packageInfo.packageManager.length === 0) {
            packageInfo.packageManager = defaultName;
        }
        await conditionalAsk(packageInfo, 'packageManager', false, 'preferred package manager:', false);
    }

    packageManager = packageInfo.packageManager;
}

async function run() {
    const pkg = await PackageFile.make();
    const remover = new FileRemover();
    const cbqueue = new CallbackQueue();

    await promptForPackageManager();
    await populatePackageInfo();
    await new Features().run(pkg, remover, cbqueue);

    stdout.writeln('');
    const confirm = (await askQuestion(`${yellow('Process files')} (this will modify files) [Y/n]? `)).toString();

    if (isAnswerNo(confirm)) {
        stdout.writeln(`» ${yellow('Not processing files: action canceled.  Exiting.')}`);
        rl.close();
        return;
    }

    try {
        await pkg.save();
        await cbqueue.run();
        await remover.remove();
    } catch (err) {
        console.log('Error: ', err);
    }

    try {
        await processFiles(thisDir());
        await runCommand(`${packageManager} install`);
    } catch (err) {
        console.log('Error: ', err);
    }

    try {
        await lintAndFormatSourceFiles();
    } catch (err) {
        console.log('Error: ', err);
    }

    try {
        await removeTemplateReadmeText();
        await removeAssetsDirectory();
    } catch (e) {
        console.log('Error: ', e);
    }

    try {
        stdout.write(`» ${yellow('Removing this script...')}`);
        await unlink(thisFile());
        stdout.writeln(`done ${green('✓')}`);
    } catch (err) {
        console.log('Error removing script: ', err);
    }

    try {
        await gitCommand('add .');
        await gitCommand('commit -m"commit configured template files"');
    } catch (err) {
        console.log('Error committing files: ', err);
    }
}

run().then(() => {
    rl.close();
    stdout.writeln(`${green('✓')} Done.`);
});

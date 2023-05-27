const CONFIG_PATH = 'Path to configuration file';
const EXPORTED_SEPARATOR = 'Exported separator';
const DATE_FORMAT = 'Date format';
const TIME_FORMAT = 'Time format';

module.exports = {
    entry: main,
    settings: {
        name: "AdvancedCapture",
        author: "Nurdoidz",
        options: {
            [CONFIG_PATH]: {
                type: "text",
                defaultValue: "Scripts/QuickAdd/AdvancedCapture/Config.json",
                placeholder: "path/to/config.json"
            },
            [DATE_FORMAT]: {
                type: "text",
                defaultValue: "YYYY-MM-DD",
                placeholder: "YYYY-MM-DD"
            },
            [TIME_FORMAT]: {
                type: "text",
                defaultValue: "HH:mm:ss",
                placeholder: "HH:mm:ss"
            },
            [EXPORTED_SEPARATOR]: {
                type: "text",
                defaultValue: "-",
                placeholder: "default separator"
            },
            "SortAscending": {
                type: "checkbox",
                defaultValue: true
            },
            "SkipCapture": {
                type: "checkbox",
                defaultValue: false
            },
            "Debug": {
                type: "checkbox",
                defaultValue: false
            }
        }
    }
};

let Settings;

/**
 * The QuickAdd API. QuickAdd methods like `inputPrompt` are available.
 * @example
 * let input = quickAddApi.inputPrompt('What’s your name?');
 * console.log(input);
 */
var quickAddApi;

/**
 * AdvancedCapture’s global variables as a key/value pair object, as a
 * combination of {@link config}’s variables, variables set during
 * AdvancedCapture execution, as well as QuickAdd variables. This object shares
 * the address with QuickAdd’s variables, meaning that any keys set are
 * immediately available to other QuickAdd scripts in the same macro, even if
 * AdvancedCaptures’s main function ends early (e.g. no input given in a
 * required field).
 *
 * The overwrite priority is `config < QuickAdd < AdvancedCapture`. For
 * instance:
 * 1. {@link variables} is set to {@link config} variables
 * 2. {@link variables} is overwritten by QuickAdd variables and shares the same
 *    address
 * 3. {@link variables} are modified by AdvancedCapture
 *
 * @example
 * // Suppose our script executes after AdvancedCapture
 * module.exports = (params) => {
 *     let variables = params.variables;
 *     // We can get the category we selected for capture
 *     let category = variables.category;
 *     if (category) {
 *         console.log(category.name);
 *         // --> Exercise
 *     } else {
 *         console.log('No category selected');
 *         // --> No category selected
 *     }
 * }
 */
var variables;

/**
 * The user’s configuration for AdvancedCapture as a json object. This is parsed
 * from {@link Settings[CONFIG_PATH]} and contains all settings and variables relevant to
 * AdvancedCapture. The original configuration file is never modified unless by
 * request of the user.
 */
var config;

/**
 * The main function for the AdvancedCapture addon for QuickAdd. This function
 * handles user prompts that are configured by a json file created by the user.
 * 
 * After getting input from the user, entries are added to CSV files and as single
 * lines to notes based on the configuration file.
 * 
 * Finally, variables are added to the QuickAdd instance so additional QuickAdd
 * scripts can use them. These variables also include those added in the
 * configuration file.
 * @param {object} quickAdd - QuickAdd
 * @returns 
 */
async function main(quickAdd, settings) {

    Settings = settings;
    quickAddApi = quickAdd.quickAddApi;
    variables = quickAdd.variables;
    debug.info('!Starting');

    // --- Read config json

    let configGood = await readConfig();
    if (configGood !== true) {
        if (configGood !== 2) debug.error('Error reading configuration file', { Path: Settings[CONFIG_PATH], ReturnValue: configGood });
        debug.info('!Stopping');
        return;
    }

    // --- Overwrite config variables with QuickAdd variables and set up for
    // modification by QuickCapture

    if (!variables) variables = {};
    Object.keys(quickAdd.variables).forEach(key => variables[key] = quickAdd.variables[key]);
    quickAdd.variables = variables;
    debug.info('!Loaded settings from config');

    variables.config = config;

    if (Settings.SkipCapture) {
        debug.info('Skipping capture', { SkipCapture: Settings.SkipCapture });
        debug.info('!Stopping');
        // "I just needed the config, so I’ll be on my way" -->
        return;
    }

    // --- Set up fieldPairs and writeableFields

    fieldPairs = variables.fieldPairs;
    if (!fieldPairs) variables.fieldPairs = fieldPairs = {};
    writeableFields = variables.writeableFields;
    if (!writeableFields) variables.writeableFields = writeableFields = [];

    // --- Stamp date and time

    let dateFormat = replaceVar(Settings[DATE_FORMAT]);
    variables.date = fieldPairs.Date = quickAddApi.date.now(dateFormat ? dateFormat : 'YYYY-MM-DD');
    let timeFormat = replaceVar(Settings[TIME_FORMAT]);
    variables.time = fieldPairs.Time = quickAddApi.date.now(timeFormat ? timeFormat : 'HH:mm:ss');

    // --- Prompt user for input

    if (!await promptOptions()) {
        debug.error('User prompt failed');
        debug.info('!Stopping');
        return;
    }
    variables.writeableLine = getWriteableLine();

    // --- Add to CSV file

    let category = variables.category;
    category.csvPath = replaceVar(category.csvPath);
    if (category.csvPath) {
        category.csvPath = getValidPath(category.csvPath, '.csv');
        if (category.csvPath) {
            if (!await addCaptureToCsv()) debug.error('CSV export failed', { Path: category.csvPath, Category: category });
        } else debug.error('Invalid CSV path', { Path: category.csvPath, Category: category });
    } else debug.info('Skipping CSV export', { Path: category.csvPath, Category: category });

    // --- Add to notes

    if (!await addCaptureToNotes()) {
        debug.error('Failed to write to note(s)');
    }

    debug.info('!Stopping');

}

/**
 * Reads the user’s configuration file for AdvancedCapture. If the file does not
 * exist, a blank file is created and the user is asked if they would like a
 * sample generated.
 * Return values:
 * - `true`: all ok
 * - `false`: cannot continue
 * - `2`: sample config created
 * @returns {boolean}
 */
async function readConfig() {

    debug.info('!Reading configuration file', { Path: Settings[CONFIG_PATH] });

    let path = getValidPath(replaceVar(Settings[CONFIG_PATH]), '.json');
    if (!path) {
        debug.error('Invalid path for configuration', { Path: Settings[CONFIG_PATH] });
        return false;
    }
    let file = this.app.vault.getAbstractFileByPath(path);
    if (!file) {
        debug.warn('No config file found', { Path: path });
        debug.info('Creating config file', { Path: path });
        await createFolder(path);
        file = await this.app.vault.create(path, '');
        if (!file) {
            debug.error('Failed to create config file', { Path: path });
            return false;
        } else debug.info('Created empty config file', { Path: path });
    }

    let content = await this.app.vault.read(file);
    config = tryParseJSONObject(content);
    if (!config) {
        let wantsSample = await quickAddApi.yesNoPrompt('No configuration file found!',
            'Create sample file at "' + path + '"?');
        if (wantsSample) {
            config = getSampleConfig();
            this.app.vault.modify(file, JSON.stringify(config, null, 2));
            debug.info('Created sample configuration file', { Path: path });
        }
        return 2;
    }

    if (config.variables.sortCategories === true) {
        debug.info('!Found "sortCategories" set to "true" in config');
        config.variables.sortCategories = false;
        debug.info('!Setting "sortCategories" to "false" in config');
        if (!await sortCategories(path, file)) {
            debug.error('Failed to sort categories');
            return false;
        }
    }

    // --- Get variables from config

    variables = config.variables;

    return true;

}
async function sortCategories(path, file) {

    if (!config) {
        debug.error('Config not valid', { Config: config });
        return false;
    }
    if (!config.categories) {
        debug.error('Missing categories section in config', { Type: typeof config.categories, Categories: config.categories });
        return false;
    }
    if (typeof config.categories !== 'object') {
        debug.error('Invalid categories section in config', { Type: typeof config.categories, Categories: config.categories });
        return false;
    }

    // --- Create backup config file

    const reMatchBackupJson = RegExp(/^((?:[^/]+\/)*?.+)(\.json)$/);
    const backupPath = path.replace(reMatchBackupJson, '$1.backup.json');
    if (backupPath === path) {
        debug.error('Failed to create backup for config because the backup path is the same as the config path',
            { BackupPath: backupPath, ConfigPath: path });
        return false;
    }
    debug.info('!Creating backup for config', { Path: backupPath });
    backupFile = this.app.vault.getAbstractFileByPath(backupPath);
    if (!backupFile) {
        backupFile = await this.app.vault.create(backupPath, JSON.stringify(config, null, 2));
        if (!backupFile) {
            debug.error('Failed to create backup file', { Path: backupPath });
            return false;
        }
    }
    this.app.vault.modify(backupFile, JSON.stringify(config, null, 2));
    debug.info('!Created backup file', { Path: backupPath });

    // --- Sort categories

    debug.info('!Preparing category sort');
    let map;
    if (Settings.SortAscending) {
        map = new Map([...Object.entries(config.categories)].sort());
    } else {
        map = new Map([...Object.entries(config.categories)].sort().reverse());
    }
    const sortedCategories = {};
    let hasCategories = false;
    map.forEach((value, key) => {
        sortedCategories[key] = value;
        hasCategories = true;
    });
    if (!hasCategories) {
        debug.warn('No categories to sort');
        return true;
    }

    // --- Rewrite config file

    debug.info('!Executing category sort');
    config.categories = sortedCategories;
    debug.info('!Writing config file', { Path: path });
    this.app.vault.modify(file, JSON.stringify(config, null, 2));
    debug.info('!Sort complete');
    return true;

}

/**
 * Reads from the following AdvancedCapture.{@link variables}:
 * - `separator` as string or `false`: (optional) separator between concatenation
 *   when adding capture entry to notes
 */
async function addCaptureToNotes() {

    debug.info('!Preparing capture to notes');

    let category = variables.category;
    if (!category.notes) {
        debug.error('Missing notes section in config', { Notes: category.notes });
        return false;
    }

    // --- Check file paths

    debug.info('Checking file paths');

    let icon = replaceVar(variables.icon);
    let name = replaceVar(variables.name);
    let files = [];
    let notes = [];

    for (let i = 0; i < category.notes.length; i++) {
        let validPath = replaceVar(category.notes[i].path);
        // Check if it’s a file, otherwise test as a folder -->
        let validFilePath = getValidPath(validPath, '');
        if (!validFilePath) validPath = getValidPath(validPath);

        if (validPath) {
            if (validPath.endsWith('/')) validPath += (icon ? icon + ' ' : '') + name + '.md';
            let file = this.app.vault.getAbstractFileByPath(validPath);
            if (file) {
                files.push(file);
                notes.push(category.notes[i]);
            } else {
                debug.info('File not found', { Path: validPath });
                debug.info('Creating file', { Path: validPath });
                await createFolder(validPath);
                file = await this.app.vault.create(validPath, '');
                if (file) {
                    files.push(file);
                    notes.push(category.notes[i]);
                    debug.info('Created file', { Path: validPath });
                } else {
                    debug.error('Failed to create file', { Path: validPath, Category: category });
                    debug.info('Skipping file', { Path: validPath });
                }
            };
        } else {
            debug.error('Missing or invalid path for note', { Path: category.notes[i].path, Index: i, Category: category });
            debug.info('Skipping file', { Path: category.notes[i].path });
        }
    }

    // --- Check config contradictions

    debug.info('Checking config');

    for (let i = files.length - 1; i >= 0; i--) {
        let topOrBottom = notes[i].topOrBottom;
        let header = notes[i].header;
        if (topOrBottom !== 'top' && topOrBottom !== 'bottom') {
            files.splice(i, 1);
            notes.splice(i, 1);
            debug.error('Invalid topOrBottom value for note', { topOrBottom: topOrBottom, Path: notes[i].path });
            debug.info('Skipping file', { Path: notes[i].path });
        } else if (typeof header !== 'string') {
            if (topOrBottom === 'top') {
                files.splice(i, 1);
                notes.splice(i, 1);
                debug.error('Required header not found for top-appended note', { Header: header, Path: notes[i].path });
            } else notes[i].header = '';
        }
    }

    // --- Read notes and modify content

    debug.info('Reading notes');

    let fileContent = [];

    for (let i = 0; i < files.length; i++) {
        let content = await this.app.vault.read(files[i]);
        let separator = notes[i].separator;
        if (typeof separator !== 'string') separator = ' - '; else separator = ' ' + separator + ' ';
        let topOrBottom = notes[i].topOrBottom;
        let fields = variables.writeableFields;
        let asTodo = notes[i].asTodo;
        let header = replaceVar(notes[i].header);

        let line = '';
        if (asTodo === true) line += '- [ ] ';
        if (notes[i].writeDate !== false) {
            if (notes[i].linkDate === true) line += '[[';
            line += variables.date;
            if (notes[i].linkDate === true) line += ']]';
        } else line += variables.date;
        if (notes[i].writeTime !== false) line += ' ' + variables.time;
        line += separator + fields.join(separator);
        if (topOrBottom === 'top') {
            content = content.replace('\n' + header + '\n\n', '');
            content = '\n' + header + '\n\n' + line + '\n' + content;
        } else {
            content += '\n' + line;
        }
        fileContent.push(content);
    }

    // --- Write to notes

    debug.info('!Writing to notes');

    files.forEach((file, index) => this.app.vault.modify(file, fileContent[index]));

    return true;

}

/**
 * Prompts the user for input for the chosen category. All fields in the
 * category are prompted in the order they appear in the {@link config} file.
 * @returns `true` or `false`: “Successfully captured input for all fields”
 */
async function promptOptions() {

    // --- Prompt user for category ---

    let categories = config.categories;
    if (!categories) {
        debug.error('Missing category section in config', { Categories: categories });
        await quickAddApi.infoDialog('Missing category section in config', 'Console recommends looking at the example config');
        return false;
    }

    Object.keys(categories).forEach(key => {
        let value = categories[key];
        delete categories[key];
        key = replaceVar(key);
        categories[key] = value;
    });

    let category;
    {
        let display = Object.keys(categories);
        let actual = [...display];
        if (display.length < 1) {
            debug.error('Category list is empty in config', { Categories: categories });
            await quickAddApi.infoDialog('Empty category list', 'Console recommends looking at the example config');
        }
        display.forEach((item, i, l) => {
            if (categories[item].icon) l[i] = categories[item].icon + ' ' + item;
        });
        debug.info('Prompting for category', { List: display });
        let selection = await quickAddApi.suggester(display, actual);
        category = categories[selection];
    }
    if (!category) {
        debug.error('No category selected', { Category: category });
        return false;
    }
    variables.category = category;
    variables.name = category.name;
    variables.icon = category.icon;
    debug.info('Category selected', { Category: category });

    if (!variables.writeableFields) variables.writeableFields = [];
    let writeableFields = variables.writeableFields;
    let fieldPairs = variables.fieldPairs;
    let reMatchCommas = RegExp(/[,]/g);

    if (!category.fields) category.fields = {};
    let fieldObjs = Object.values(category.fields);

    debug.info('Prompting for fields', { Category: category.name });

    // --- Capture input for each field

    for (let i = 0; i < fieldObjs.length; i++) {
        let field = fieldObjs[i];
        Object.keys(field).forEach(key => field[key] = replaceVar(field[key]));
        field.required = (field.required === true || field.required === 'true');
        field.write = (field.write === true || field.write === 'true');
        field.hasIcons = (field.hasIcons === true || field.hasIcons === 'true');
        if (!field.name) {
            debug.error('Missing field name', { Field: field.name, Index: i, Category: category });
            return false;
        }
        // The CSV Party commands all commas see the Delete chamber
        if (reMatchCommas.test(field.name)) {
            debug.warn('Removing commas from field name', { Field: field.name, Index: i, Category: category });
            field.name = field.name.replace(reMatchCommas, '');
        }
        let input;
        let writeableInput;
        debug.info('Prompting for input', { Field: field.name, Category: category.name });

        // --- Based on input type of the field ---

        switch (field.prompt) {
            case "wideInputPrompt":
            case "inputPrompt":
                if (field.prompt === 'wideInputPrompt') {
                    input = await quickAddApi.wideInputPrompt(field.name + (field.required ? ' (Required)' : ''));
                } else input = await quickAddApi.inputPrompt(field.name + (field.required ? ' (Required)' : ''));
                input = replaceVar(input);
                writeableInput = input;
                if (typeof field.prefix === 'string') writeableInput = field.prefix + writeableInput;
                if (typeof field.suffix === 'string') writeableInput += field.suffix;
                writeableInput = replaceVar(writeableInput);
                if (!input && input != '0') {
                    if (field.required) {
                        debug.error('No input received for required field', { Input: input, Required: field.required, Field: field.name, Category: category });
                        return false;
                    }
                    input = '';
                } else if (field.write) writeableFields.push(formatField(writeableInput, field.format));
                break;

            case "yesNoPrompt":
                input = await quickAddApi.yesNoPrompt(field.name);
                writeableInput = input;
                if (typeof field.prefix === 'string') writeableInput = field.prefix + writeableInput;
                if (typeof field.suffix === 'string') writeableInput += field.suffix;
                writeableInput = replaceVar(writeableInput);
                if (typeof input !== 'boolean') {
                    debug.error('No input received', { Input: input, Field: field.name, Category: category.name });
                } else if (field.write) writeableFields.push(formatField(writeableInput, field.format));
                break;

            case "suggester":
                let path = getValidPath(field.listPath, '.md');
                if (!path) {
                    debug.error('Missing or invalid path for list', { Path: path, Field: field.name, Category: category });
                    if (field.required) return false;
                    input = '';
                }
                let file = this.app.vault.getAbstractFileByPath(path);
                if (!file) {
                    debug.info('File for list not found; trying to create', { Field: field.name, Category: category });
                    await createFolder(path);
                    file = await this.app.vault.create(path, '');
                    if (!file) {
                        debug.error('Failed to create file for list', { Field: field.name, Category: category });
                        if (field.required) return false;
                        input = '';
                    }
                    debug.info('File for list created', { Field: field.name, Category: category });
                }
                do {
                    let content = await this.app.vault.read(file);
                    content = content.trim();
                    {
                        let display = [];
                        if (content.length > 0) content.split('\n').forEach(line => {
                            line = replaceVar(line);
                            display.push(line);
                        });

                        // let item = '';
                        // if (field.hasIcons) item += '✨ ';
                        // item += 'Add';
                        display.push('✨ Add');

                        let actual = display.slice(0, -1);
                        actual.push('!add');

                        input = await quickAddApi.suggester(display, actual);
                    }
                    // Blank or invalid input == "I don’t think I belong here" -->
                    if (!input) {
                        debug.error('Nothing selected from the list', { Input: input, Field: field.name, Category: category });
                        if (field.required) return false;
                        input = '';
                    }
                    if (input === '!add') {
                        debug.info('Prompting for new item in list', { Field: field.name, Category: category });
                        let icon;
                        if (field.hasIcons) {
                            icon = await quickAddApi.inputPrompt('Icon for new "' + field.name + '" in "' + category.name + '"');
                            if (icon) icon = icon.replace(/\s/g, '');
                            // Blank or invalid icon == "Nevermind, take me back!" -->
                            if (!icon) {
                                debug.error('Invalid icon entered', { Icon: icon, Field: field.name, Category: category });
                            }
                        }
                        if (field.hasIcons === !!icon) {
                            let name = await quickAddApi.inputPrompt('Name for new "' + field.name + '" in "' + category.name + '"');
                            if (name) {
                                name = name.trim();
                                content += '\n' + (icon ? icon + ' ' : '') + name;
                                content = content.trim();
                                this.app.vault.modify(file, content);
                                debug.info('Added new option', { Icon: icon, Name: name, Field: field.name, Category: category });
                            } else {
                                debug.error('Invalid name entered', { Name: name, Field: field.name, Category: category });
                            }
                        }
                    }
                } while (input === '!add');
                writeableInput = input;
                if (field.hasIcons === true) {
                    reSplitInput = RegExp(/^(\S+)\s+(.+)/g);
                    splitInput = reSplitInput.exec(writeableInput);
                    if (splitInput.length === 3) {
                        splitInput = splitInput.splice(1);
                        splitInput[1] = formatField(splitInput[1], field.format);
                        writeableInput = splitInput.join(' ');
                    }
                } else writeableInput = formatField(writeableInput, field.format);
                if (typeof field.prefix === 'string') writeableInput = field.prefix + writeableInput;
                if (typeof field.suffix === 'string') writeableInput = writeableInput + field.suffix;
                input = replaceVar(input);
                writeableInput = replaceVar(writeableInput);
                if (field.write) writeableFields.push(writeableInput);
                // Who puts emojis in CSV files? -->
                if (field.hasIcons) input = input.replace(/^\S+\s+/g, '');
                break;

            default:
                debug.error('Missing, incorrect, or unsupported prompt type', { Prompt: field.prompt, Field: field.name, Category: category });
                return false;

        }
        fieldPairs[field.name] = input;
        debug.info('Added capture for field', { fieldPairs: variables.fieldPairs, writeableFields: variables.writeableFields, Field: field.name, Category: category });

    }

    // --- Capture comment field ---

    if (category.disableCommentField !== false) {
        debug.info('Prompting for comment', { Category: category });
        // No one escapes the comment section -->
        let input = await quickAddApi.inputPrompt('Comment for ' + category.name);
        if (category.commentFieldPrefix === true) input = category.commentFieldPrefix + input;
        if (category.commentFieldSuffix === true) input = input + category.commentFieldSuffix;
        input = replaceVar(input);
        if (input || input == '0') {
            variables.writeableFields.push(formatField(input, category.commentFieldFormat));
        }
        fieldPairs.Comment = input;
    }

    debug.info('Capture successful', { fieldPairs: fieldPairs, writeableFields: writeableFields, Category: category });
    return true;

}

/**
 * Formats and returns a string using markdown formatting. The formatting is
 * stacked if more than one format is selected. Supported options include:
 * - bold
 * - italics
 * - strikethrough
 * - highlight
 * @param {string} str string to format
 * @param {object} formatOptions formatting options
 * @returns formatted string
 * @example
 * let message = 'Watch yourself!';
 * message = formatField(message, { bold: true });
 * console.log(message);
 * // --> **Watch yourself!**
 */
function formatField(str, formatOptions) {
    if (typeof str !== 'string' || !str) return str;
    if (typeof formatOptions !== 'object' || !formatOptions) return str;
    str = str.trim();
    if (formatOptions.bold === true) str = '**' + str + '**';
    if (formatOptions.italics === true) str = '_' + str + '_';
    if (formatOptions.strikethrough === true) str = '~~' + str + '~~';
    if (formatOptions.highlight === true) str = '==' + str + '==';
    return str;
}

/**
 * Appends a capture to the selected category’s CSV file. The CSV file is created
 * if it does not exist.
 * @returns `true` or `false`: “Succesfully added to CSV file”
 */
async function addCaptureToCsv() {

    let fieldPairs = variables.fieldPairs;
    if (!fieldPairs) {
        debug.error('Invalid input for export', { Fields: fieldPairs });
        return false;
    }
    let path = variables.category.csvPath;
    debug.info('!Exporting to CSV', { Path: path });
    let contents;
    let file = this.app.vault.getAbstractFileByPath(path);
    if (!file) {
        debug.info('CSV file not found; trying to create', { Path: path });
        contents = Object.keys(fieldPairs).join(',');
        await createFolder(path);
        file = await this.app.vault.create(path, contents);
        if (!file) {
            debug.error('Failed to create CSV file', { Path: path });
            return false;
        }
        debug.info('CSV file created', { Path: path });
    }
    contents = await this.app.vault.read(file);
    contents = contents.trim();
    values = Object.values(fieldPairs);
    values.forEach((value, i, v) => {
        v[i] = (typeof value !== 'undefined' ? (shouldQuote(value) ? '"' + value + '"' : value) : '');
    });
    contents += values.join(',') + '\n';
    this.app.vault.modify(file, contents);
    debug.info('!Capture added to CSV', { Capture: fieldPairs, Path: path });
    return true;

}

/**
 * Returns a markdown-formatted string containing only values obtained by
 * prompts. Automatically generated values including the date, time, or todo
 * formatting is omitted.
 * @returns {string} a markdown-formatted string, including the default
 * separator
 */
function getWriteableLine() {
    let separator = replaceVar(Settings[EXPORTED_SEPARATOR]);
    if (separator.length > 0) separator = ' ' + separator + ' ';
    return variables.writeableFields.join(separator);
}

/**
 * Determines if the given string matches a number, decimal, or boolean.
 * @param {string} value -
 * @returns {boolean} `false` if number, decimal, or boolean; `true` otherwise
 * @example
 * let input = ["true", "5.6", "17", "Tarzan", "Jane2"];
 * let output = [];
 * input.forEach(e => {
 *     output.push(shouldQuote(e));
 * });
 * console.log(input);
 * // --> Array ["true", "5.6", "17", "Tarzan", "Jane2"]
 * 
 * console.log(output);
 * // --> Array [true, true, true, false, false]
 */
function shouldQuote(value) {
    let matchNonString = RegExp(/^(\d*([.]\d+)?)$|^true$|^false$/gm);
    return !matchNonString.test(value);
}

/**
 * Converts the given path to an Obsidian-friendly folder path and returns the
 * result. If the given path is `undefined`, _empty_, or not a string, it returns
 * `false`.
 * 
 * If an extension is defined, the function goes into _file-only_ mode and will
 * return `false` **unless** all the following conditions are `true`:
 * - the path contains a file extension
 * - the file extension matches the given extension
 * - the path is valid
 * 
 * If so, the valid path will be returned instead.
 * @param {string} path 
 * @param {string} [ext] extension
 * @returns {string}
 * @example 
 *  let path = '//docs/example.json';
 *  let newPath = getValidPath(path, '.json');
 *  console.log(newPath)
 *  // --> 'docs/example.json'
 */
function getValidPath(path, ext) {

    if (typeof path !== 'string') return false;
    path = path.trim();
    if (!path) return false;

    let matchNewline = RegExp(/[\n\r]/g);
    path = path.replace(matchNewline, '');

    let matchTwoPlusSlashes = RegExp(/\/{2,}/g);
    path = path.replace(matchTwoPlusSlashes, '/');

    let matchLeadingSlash = RegExp(/^\/(.+)/g);
    path = path.replace(matchLeadingSlash, '$1');

    // Valid file path -->
    let matchHasExtension = RegExp(/(\.\w{0,5})$/g);
    if (typeof ext === 'string') {
        return (matchHasExtension.test(path) ? path : false);
    } else if (matchHasExtension.test(path)) return false;

    // Valid folder path -->
    let matchEndsWithSlash = RegExp(/.*\/$/g);
    return path + (matchEndsWithSlash.test(path) ? '' : '/');

}

async function createFolder(path) {

    if (typeof path !== 'string') return false;
    path = path.trim();
    if (!path) return false;

    let matchNewline = RegExp(/[\n\r]/g);
    path = path.replace(matchNewline, '');

    let matchTwoPlusSlashes = RegExp(/\/{2,}/g);
    path = path.replace(matchTwoPlusSlashes, '/');

    let matchChildren = RegExp(/[^/]+\//g);
    if (((path || '').match(matchChildren) || []).length < 1) {
        return true;
    }

    let matchValidFolder = RegExp(/((?:[^/]+\/)+)[^/]*/g);
    path = path.replace(matchValidFolder, '$1');

    await this.app.vault.createFolder(path).catch(e => { console.warn(e); });;
    return true;

}

/**
 * Replaces all instances of `var(name)`, each with the value of the matching
 * key from AdvancedCapture.{@link variables}. It also executes any functions
 * it finds, but only after it replaces all variables it can find.
 * 
 * If the given string is `undefined` or not a string, the argument is returned
 * as-is.
 * 
 * This function is recursive. It will work its way starting with nested `var(n)`
 * first, left to right. For example, given the string:
 * ```text
 * var(date) var(time) - var(msg)
 * ```
 * 
 * ...with the following AdvancedCapture.{@link variables}:
 * ```json
 * {
 *   "date": "2023-05-23",
 *   "linkDate": "[[var(date)]]",
 *   "timeFormat": "HH:mm:ss",
 *   "time": "quickAddApi.date.now('var(timeFormat)')",
 *   "msg": "Array.of('hello', 'world').join(' ')"
 * }
 * ```
 * 
 * ...the following order of replacements will happen:
 * 1. `var(linkDate) var(time) - var(msg)`
 * 2. `[[var(date)]] var(time) - var(msg)`
 * 3. `[[2023-05-23]] var(time) - var(msg)`
 * 4. `[[2023-05-23]] quickAddApi.date.now('var(timeFormat)') - var(msg)`
 * 5. `[[2023-05-23]] quickAddApi.date.now('HH:mm:ss') - var(msg)`
 * 6. `[[2023-05-23]] quickAddApi.date.now('HH:mm:ss') - Array.of('hello', 'world').join(' ')`
 * 6. `[[2023-05-23]] 12:31:43 - Array.of('hello', 'world').join(' ')`
 * 6. `[[2023-05-23]] 12:31:43 - hello world`
 * @param {string} str string containing `var(name)`
 * @returns {string} string with replacements
 */
function replaceVar(str) {

    if (!variables) {
        debug.error('Variables not set');
        return str;
    }
    if (typeof str !== 'string') {
        return str;
    }
    let output = str;
    let reMatchVar = RegExp(/var\((.+?)\)/);
    if (reMatchVar.test(output)) {
        let match = output.match(reMatchVar);
        match = match[0].replace(reMatchVar, '$1');
        let value = variables[match];
        if (value === undefined) debug.warn('Variable does not exist', { Variable: match, Variables: variables });
        output = output.replace(reMatchVar, value);
    }
    if (reMatchVar.test(output)) {
        output = replaceVar(output);
    }
    let reMatchFunction = RegExp(/((?:\w+[.]?)+\(.*?\)(?:[.](?:\w+[.]?)+\(.*?\))*)/);
    if (reMatchFunction.test(output)) {
        let match = output.match(reMatchFunction);
        match = match[0].replace(reMatchFunction, '$1');
        let value = eval(match);
        if (value === undefined) value = '';
        output = output.replace(reMatchFunction, value);
    }
    if (reMatchVar.test(output) || reMatchFunction.test(output)) {
        output = replaceVar(output);
    }

    return output;

}

const debug = {
    log: (type, str, kvObj) => {
        if (typeof str !== 'string') str = '';
        if (typeof type === 'undefined') return;
        if (type !== 'Warning' || type !== 'Error') {
            if (str.startsWith('!')) {
                str = str.substring(1);
            } else if (!Settings.Debug) return;
        }

        let isOneLine = false;
        let hasSingleKey = false;
        if (typeof kvObj === 'undefined') {
            isOneLine = true;
        } else if (
            (Object.keys(kvObj).length == 1) && (typeof Object.values(kvObj)[0] !== 'object')
        ) hasSingleKey = true;

        let suffix = '';
        let prefix = '%c[AdvancedCapture]%c ';
        if (hasSingleKey) {
            const key = Object.keys(kvObj)[0];
            suffix += '\n%c' + key + ': ' + kvObj[Object.keys(kvObj)[0]];
        } else {
            suffix += '%c';
            if (!isOneLine) suffix += '%c';
        }

        let blue = "color: #27C6F1";
        let inherit = "color: inherit";
        let orange = "color: #F18C27";
        let magenta = "color: #D927F1";
        let red = "color: F12727";

        if (isOneLine) {
            switch (type) {
                case 'Warning':
                    console.warn(prefix + str + suffix, blue, inherit, orange);
                    break;
                case 'Error':
                    console.error(prefix + str + suffix, blue, inherit, orange);
                    break;
                default:
                    console.info(prefix + str + suffix, blue, inherit, orange);
                    break;
            }
            return;
        }

        switch (type) {
            case 'Warning':
                console.groupCollapsed(prefix + str, blue, orange);
                break;
            case 'Error':
                console.groupCollapsed(prefix + str, blue, red);
                break;
            default:
                console.groupCollapsed(prefix + str, blue, inherit);
                break;
        }

        if (hasSingleKey) {
            console.info('%c' + Object.keys(kvObj)[0] + ':%c ' + kvObj[Object.keys(kvObj)[0]], magenta, inherit);
        } else {
            Object.keys(kvObj).forEach(k => {
                console.info('%c' + k + ': ', magenta, kvObj[k]);
            });
            if (type === 'Error') {
                console.info('%cConfig' + ': ', magenta, config);
                console.info('%cVariables' + ': ', magenta, variables);
            }
        }
        console.groupEnd();
    },
    /**
     * Writes an informational message to the console, if {@link variables}.debug
     * is set to `true`. If an object with key/value pairs (`string: object`) is
     * passed, those values are also written.
     * 
     * You can bypass {@link variables}.debug by including an exclamation point
     * `!` as the first character of the message string.
     * 
     * @param {string} str message
     * @param {*} kvObj object of key/value pairs
     */
    info: (str, kvObj) => {
        debug.log('Info', str, kvObj);
    },
    /**
     * Writes a warning message to the console. If an object with key/value pairs
     * (`string: object`) is passed, those values are also written.
     * 
     * @param {string} str message
     * @param {*} kvObj object of key/value pairs
     */
    warn: (str, kvObj) => {
        debug.log('Warning', str, kvObj);
    },
    /**
     * Writes an error message to the console. The current states of
     * AdvancedCapture.{@link variables} and the user {@link config} are
     * automatically included. If an object with key/value pairs
     * (`string: object`) is passed, those values are also written.
     * 
     * @param {string} str message
     * @param {*} kvObj object of key/value pairs
     */
    error: (str, kvObj) => {
        debug.log('Error', str, kvObj);
    }
};

/**
 * Checks if the given json string can be parsed into an object and returns the
 * object if it can. Otherwise, it will return false.
 * @param {string} jsonString 
 * @returns 
 */
function tryParseJSONObject(jsonString) {
    try {
        var o = JSON.parse(jsonString);
        if (o && typeof o === "object") {
            return o;
        }
    }
    catch (e) { }

    return false;
};

/**
 * 
 * @returns sample config
 */
function getSampleConfig() {
    return {
        "variables": {
            "debug": false,
            "dateFormat": "YYYY-MM-DD",
            "timeFormat": "HH:mm:ss",
            "sortCategories": false
        },
        "categories": {
            "Exercise": {
                "icon": "🏊‍♀️",
                "fields": [
                    {
                        "name": "Activity",
                        "prompt": "suggester",
                        "listPath": "Journal/Exercise Activities.md",
                        "format": "italics",
                        "hasIcons": true,
                        "write": true
                    },
                    {
                        "name": "Rating",
                        "prompt": "inputPrompt",
                        "format": "bold",
                        "dataView": "rating",
                        "suffix": "/10",
                        "write": true
                    }
                ]
            }
        }
    };
}
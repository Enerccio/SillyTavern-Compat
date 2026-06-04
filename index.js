
class SharedFunction {
    constructor(schema = {}) {
        const callable = async (...args) => await callable._invoke(...args);
        Object.setPrototypeOf(callable, SharedFunction.prototype);

        callable._callables = [];
        callable._schema = {
            inputs: schema.inputs || [],
            validateOutput: schema.validateOutput || (() => true),
            debug: !!schema.debug
        };

        return callable;
    }

    // Static helper to wrap complex objects/arrays as optional
    static optional(schemaDef) {
        return { __optional: true, schema: schemaDef };
    }

    _deepValidate(value, schemaDef, path = "arg") {
        // 1. Handle explicit structural optional wrapper
        if (schemaDef && schemaDef.__optional) {
            if (value === undefined || value === null) {
                return null; // Valid: it's optional and missing
            }
            schemaDef = schemaDef.schema; // Unwrap it to validate its contents
        }

        // 2. Handle primitive type checking (including shorthand 'string?')
        if (typeof schemaDef === 'string') {
            const isOptional = schemaDef.endsWith('?');
            const expectedType = isOptional ? schemaDef.slice(0, -1) : schemaDef;

            if (value === undefined || value === null) {
                if (isOptional) return null; // Valid: optional primitive is missing
                return `Expected type "${expectedType}" at [${path}], but got "missing".`;
            }

            if (typeof value !== expectedType) {
                return `Expected type "${expectedType}" at [${path}], but got "${typeof value}".`;
            }
            return null;
        }

        // 3. If the value itself is missing, but the schema demands a required Object/Array
        if (value === undefined || value === null) {
            return `Missing required structure at [${path}].`;
        }

        // 4. Handle Arrays
        if (Array.isArray(schemaDef)) {
            if (!Array.isArray(value)) return `Expected an Array at [${path}], but got "${typeof value}".`;
            for (let i = 0; i < value.length; i++) {
                const error = this._deepValidate(value[i], schemaDef[0], `${path}[${i}]`);
                if (error) return error;
            }
            return null;
        }

        // 5. Handle Objects
        if (typeof schemaDef === 'object' && schemaDef !== null) {
            if (typeof value !== 'object') {
                return `Expected an Object at [${path}], but got "${typeof value}".`;
            }
            for (let key in schemaDef) {
                const error = this._deepValidate(value[key], schemaDef[key], `${path}.${key}`);
                if (error) return error;
            }
            return null;
        }
        return null;
    }

    registerHandler(handler) {
        if (typeof handler !== 'function') throw new TypeError("Handler must be a function.");

        let isValidated = false;

        const guardedHandler = async (...args) => {
            const shouldValidate = this._schema.debug || !isValidated;

            if (shouldValidate) {
                this._schema.inputs.forEach((schemaDef, index) => {
                    const errorMsg = this._deepValidate(args[index], schemaDef, `args[${index}]`);
                    if (errorMsg) {
                        throw new TypeError(`Handler "${handler.name || 'anonymous'}" input validation failed: ${errorMsg}`);
                    }
                });
            }

            const result = await handler(...args);

            if (shouldValidate) {
                if (!this._schema.validateOutput(result)) {
                    throw new TypeError(`Handler "${handler.name || 'anonymous'}" output validation failed.`);
                }
                isValidated = true;
            }

            return result;
        };

        Object.defineProperty(guardedHandler, 'name', { value: handler.name });
        this._callables.push(guardedHandler);
    }

    async _invoke(...args) {
        let [returnValue, ...restArgs] = args;
        for (let c of this._callables) {
            let [retVal, continueStatus] = await c(returnValue, ...restArgs);
            if (!continueStatus) return retVal;
            returnValue = retVal;
        }
        return returnValue;
    }
}

window.enerccio_compat = {
    /** @type {((textData: string, chatMessage: any, context?: any) => Promise<any>) & SharedFunction} */
    'messageProcessor': new SharedFunction({
        inputs: [
            'string',
            {
                role: 'string',
                content: 'string'
            },
            SharedFunction.optional({
                'imprint': 'boolean?',
                'postprocess': 'function?',
                'messageId': 'integer?',
            })
        ],
        validateOutput: (result) => Array.isArray(result) && result.length === 2
    }),
    /** @type {((textData: string, context?: any) => Promise<any>) & SharedFunction} */
    'textProcessor': new SharedFunction({
        inputs: [
            'string',
            SharedFunction.optional({
                'imprint': 'boolean?',
                'postprocess': 'function?',
                'messageId': 'integer?',
            })
        ],
        validateOutput: (result) => Array.isArray(result) && result.length === 2
    })
};

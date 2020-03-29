const peg = require('pegjs')
const fs = require('fs')
// const uni = require('unicharadata')

let snakeCase = (s) =>
    s === '_' ? 'underscore' :
        s.replace(/^_/, "underscore_")
            .replace(/_$/, "_underscore")

let pascalCase = (s) =>
    s === 'char' ? s :
        s.replace(/_+/, "_")
        .replace(/^_/, "underscore-")
            .replace(/_$/, "-underscore")
            .replace(/(^.|[-_].)/g, x => x.toLocaleUpperCase())
            .replace(/[-_]/g, '')

function walk(fn, expr) {
    if (expr) {
        switch (expr.type) {
            case 'class':
            case 'literal':
            case 'any':
            case 'rule_ref':
            case 'alias':
            case 'class':
                return fn(expr)
            case 'text':
            case 'named':
            case 'group':
            case 'optional':
            case 'zero_or_more':
            case 'one_or_more':
            case 'labeled':
            case 'rule':
            case 'action':
            case 'simple_and':
            case 'simple_not':
                return fn({ ...expr, expression: walk(fn, expr.expression) })
            case 'list':
            case 'option':
                return fn({ ...expr, of: walk(fn, expr.of) })
            case 'sequence':
            case 'tuple':
                return fn({ ...expr, elements: expr.elements.map(e => walk(fn, e)) })
            case 'choice':
                return fn({ ...expr, alternatives: expr.alternatives.map(e => walk(fn, e)) })
            case 'union':
                return fn({ ...expr, cases: expr.cases.map(e => walk(fn, e)) })
            default:
                console.log(expr);
                throw new Error(`idk ${expr.type}`);
        }
    } else {
        return e => walk(fn, e)
    }
}

const metagrammarSource = fs.readFileSync(__dirname + '/parser.pegjs', 'utf8')
// // const metagrammarSource = `__ = (WhiteSpace / LineTerminatorSequence / Comment)* `
// // const oskarGrammarSource = fs.readFileSync('oskar.peg', 'utf8')
// const oskarGrammarSource = fs.readFileSync('simple.peg', 'utf8')
const metaParser = peg.generate(metagrammarSource)
// const tree = metaParser.parse(oskarGrammarSource)

function removeActions(expr) {
    if (expr.type === 'action')
        return expr.expression;
    return expr;
}

function fsharpType(expr) {
    switch (expr.type) {
        case "action":
            return fsharpType(expr.expression)
        case "rule":
        case "named":
            return {
                name: expr.name,
                ...fsharpType(expr.expression)
            }
        case "labeled":
            return {
                name: expr.label,
                ...fsharpType(expr.expression)
            }
        case "class":
            return { type: "class", parts: expr.parts, inverted: expr.inverted }
        case "literal":
            return { type: "literal", value: expr.value }
        case "rule_ref":
            return { type: "alias", to: expr.name }
        case "sequence":
            return { type: "tuple", elements: expr.elements.map(fsharpType) }
        case "choice":
            return { type: "union", cases: expr.alternatives.map(fsharpType) };
        case "one_or_more":
            return { type: "list", minimum: 1, of: fsharpType(expr.expression) };
        case "zero_or_more":
            return { type: "list", minimum: 0, of: fsharpType(expr.expression) };
        case "optional":
            return { type: "option", of: fsharpType(expr.expression) };
        case "group":
            return fsharpType(expr.expression);
    }
}

function flattenRule(expr, options) {
    switch (expr.type) {
        case "list":
        case "option":
            if (expr.of.type !== 'literal' && expr.of.type !== 'alias' && expr.of.type !== 'class') {
                let name = expr.of.name || expr.name + "_expression"
                let newRule = { name, ...expr.of }
                return [{ ...expr, of: { type: 'alias', to: name } }, flattenRule(newRule, options)]
            }
            return [expr];

        case "union":
            i = 0;
            let caseRules = expr.cases.map(c => {
                i++;
                if (c.type !== 'literal' && c.type !== 'class' && c.type !== 'alias') {
                    // not a literal or an alias, extract into a new rule
                    let name = c.name ? `${expr.name}_${c.name}` : `${expr.name}_case${i}`
                    let newRule = { ...c, name }
                    c.type = "alias"
                    c.to = name
                    return flattenRule(newRule, options)
                }
            })
            return [expr, caseRules]

        case "tuple":
            i = 0;
            let elementRules = expr.elements.map(e => {
                i++
                if (e.type !== 'literal' && e.type !== 'class' && e.type !== 'alias') {
                    // not a literal or an alias, extract into a new rule
                    let name = e.name ? `${expr.name}_${e.name}` : `${expr.name}_element${i}`
                    let newRule = { ...e, name }
                    e.type = "alias"
                    e.to = name
                    return flattenRule(newRule, options)
                }
            })
            return [expr, elementRules]
    }

    return [expr]
}

function discardRules(expr, options) {
    let discardNameSet = new Set(options.discardNamed)
    return walk(e => {
        if ((options.discardLiterals && e.type === 'literal')
            || (options.discardLiterals && e.type === 'option' && e.of.type === 'literal')
            || (options.discardLiterals && e.type === 'list' && e.of.type === 'literal')
            || discardNameSet.has(e.name)
            || (e.name && e.name.startsWith(options.discardPrefix))
            || (e.type === 'alias' && discardNameSet.has(e.to))
            || (e.type === 'alias' && e.to.startsWith(options.discardPrefix))) {
            e.discard = true;
        }
        return e;
    }, expr);
}

function assignNames(expr) {
    if (expr.type === 'union') {
        let i = 0;
        for (const c of expr.cases) {
            // TODO support multiple cases of same alias?
            c.name = c.name || c.to || `${expr.name}Case${i}`
            i++
        }
    }
    return expr;
}

let __i = 0
let nextId = () => __i++

function literalName(s) {
    return "ArzLiteral"
}

function typeName(t) {
    switch (t.type) {
        case "literal":
            return literalName(t.value)
        case "alias":
            return pascalCase(t.to)// + (t.suffix ? ` ${t.suffix}` : "")
        default:
            throw `cant get type name for ${t.type}`
    }
}

function renderUnionCase(c) {
    let name = c.name || `MissingName${nextId()}`

    switch (c.type) {
        case "literal":
            return `| ${pascalCase(name)} of ${typeName(c)}`
        case "alias":
            return `| ${pascalCase(name)} of ${typeName(c)}`
    }
    throw c.type;
}

function renderSequenceElement(e) {
    let label = e.name ? `${e.name}:` : ""
    switch (e.type) {
        case "literal":
            return `${label}${typeName(e)}`
        case "class":
            return `${label}char`
        case "list":
            return `${label}${renderSequenceElement(e.of)} list`
        case "option":
            return `${label}${renderSequenceElement(e.of)} option`
        case "alias":
            return `${label}${typeName(e)}`
    }
    console.log(e);

    throw e.type
}

function renderType(t, options) {
    let name = t.name ? pascalCase(t.name) : `MissingName${nextId()}`
    switch (t.type) {
        case 'alias':
            return `${name} = ${name} of ${typeName(t)}`
        case 'literal':
            return `${name} = ${typeName(t)}`
        case 'class':
            return `${name} = ${name} of char`
        case 'union':
            return `${name} = \n${t.cases.map(renderUnionCase).join("\n")}`
        case 'list':
            return t.of.type === 'class'
                ? `${name} = string`
                : `${name} = ${typeName(t.of)} list`
        case 'option':
            return `${name} = ${name} of ${typeName(t.of)} option`
        case 'tuple':
            let elements = t.elements.filter(e => !e.discard);
            if(elements.length == 0) {
                return `${name} = ${name}`
            } else {
                return `${name} = ${name} of ${elements.map(renderSequenceElement).join(" * ")}`
            }
        default:
            throw t.type
    }
}
function escapeRegexp(s) {
    return s
        .replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')
        .replace("\n", "\\n")
        .replace("\t", "\\t")
};

function regexString(t) {
    return `[${(t.inverted ? '^' : '') + t.parts.map(p => Array.isArray(p) ? p.join('-') : escapeRegexp(p)).join('')}]`;
}

function renderSequenceElementParser(e) {
    switch (e.type) {
        case 'literal': return `expectLiteral sr "${e.value}"`
        case 'class': return `expectMatch (Regex "${regexString(e)}") sr`
        case 'option': return renderSequenceElementParser(e.of);
        case 'list':
            switch (e.of.type) {
                case 'alias': return `parseList sr ${e.minimum} ${snakeCase(e.of.to)}`
                case 'class': return `parseList sr ${e.minimum} (expectMatch (Regex "${regexString(e.of)}"))`
                default: throw `renderSequenceElementParser list ${e.of.type}`
            }
        case 'alias':
            return `${snakeCase(e.to)} sr`
        default: throw 'renderSequenceElementParser! ' + e.type
    }
}

function renderParser(t, options) {
    let lines = [`${snakeCase(t.name)} (sr:SourceReader) : ${pascalCase(t.name)} option =`, "let p = position sr"]
    switch (t.type) {
        case 'alias':
            lines.push(`match ${snakeCase(t.to)} sr with`)
            lines.push(`| Some v -> Some (${pascalCase(t.name)} v)`)
            lines.push(`| None ->`)
            lines.push(`reset sr p`)
            lines.push('None')
            break;
        case 'literal':
            lines.push(`match expectString sr "${t.value}" with`)
            lines.push(`| Some _ -> Some ${literalName(t.value)}`)
            lines.push(`| None ->`)
            lines.push(`reset sr p`)
            lines.push('None')
            break;
        case 'class':
            let rx = regexString(t);
            lines.push(`match expectMatch (Regex "${rx}") sr with`)
            lines.push(`| Some s -> Some (${pascalCase(t.name)} s)`)
            lines.push(`| None ->`)
            lines.push(`reset sr p`)
            lines.push('None')
            break;
        // case 'union':
        //     return `${name} = \n${t.cases.map(renderUnionCase).join("\n")}`
        case 'list':
            if (t.of.type === 'class') {
                let rx = regexString(t.of);
                // class lists are strings
                lines.push(`let pattern = Regex "${rx}"`)
                lines.push(`let rec readString s =`)
                lines.push(`  match expectMatch pattern sr with`)
                lines.push(`  | Some c -> readString (s + (string c))`)
                lines.push(`  | None -> s`)
                lines.push(`match readString "" with`)
                lines.push(`| s when s.Length >= ${t.minimum} -> Some s`)
                lines.push(`| _ ->`)
                lines.push(`reset sr p`)

            } else {
                if (!t.of.to) throw "!!"
                lines.push(`let rec readList list =`)
                lines.push(`  match ${snakeCase(t.of.to)} sr with`)
                lines.push(`  | Some next -> readList (List.append list [next])`)
                lines.push(`  | None -> list`)
                lines.push(`match readList [] with`)
                lines.push(`| list when List.length list >= ${t.minimum} -> Some list`)
                lines.push(`| _ ->`)
                lines.push(`reset sr p`)
            }
            lines.push('None')
            break;

        case 'option':
            switch (t.of.type) {
                case 'alias':
                    lines.push(`match ${snakeCase(t.of.to)} sr with`)
                    lines.push(`| Some v -> Some (${pascalCase(t.name)} (Some v))`)
                    lines.push(`| None -> Some (${pascalCase(t.name)} None) `)
                    break;
                case 'literal':
                    lines.push(`match expectLiteral sr "${t.of.value}" with`)
                    lines.push(`| Some v -> Some (${pascalCase(t.name)} (Some v))`)
                    lines.push(`| None -> Some (${pascalCase(t.name)} None)`)
                break;
                default:
                    throw `${t.of.type} not supported in option parser`
            }
            break;

        case 'tuple':
            let i = 0;
            let matchVars = []

            t.elements.forEach(e => {
                let v = `var${i++}`
                lines.push(`let ${v} = ${renderSequenceElementParser(e)}`)
                lines.push(`if Option.isNone ${v} then`)
                lines.push(`  reset sr p; None`)
                lines.push(`else`)
                if (!e.discard)
                    matchVars.push(e.type === 'option' ? v : `Option.get ${v}`)
            })
            let matchVarsString = matchVars.length == 0 ? "" : ` (${matchVars})`
            lines.push(`  Some (${pascalCase(t.name)}.${pascalCase(t.name)}${matchVarsString})`)
            break;

        case 'union':
            for (const c of t.cases) {
                switch (c.type) {
                    case 'alias':
                        lines.push(`match ${snakeCase(c.to)} sr with`)
                        lines.push(`| Some x -> Some (${pascalCase(t.name)}.${pascalCase(c.name)} x)`)
                        lines.push(`| _ ->`)
                        lines.push(`reset sr p`)
                        break;
                    case 'literal':
                        lines.push(`match expectLiteral sr "${c.value}" with`)
                        lines.push(`| Some x -> Some (${pascalCase(t.name)}.${pascalCase(c.name)} x)`)
                        lines.push(`| _ ->`)
                        lines.push(`reset sr p`)

                        break;
                    default: throw c.type
                }
            }
            lines.push('None')
            break;

        default:
            throw t.type
    }
    return lines.join("\n  ")
}

function renderAstType(rules, options) {
    return "type " + rules.map(e => renderType(e, options)).join("\nand ")
}
function renderParsingFunctions(rules, options) {
    return "let rec " + rules.map(e => renderParser(e, options)).map(s => s.trim()).join("\nand ")
}

const preambleSource = fs.readFileSync(__dirname + '/preamble.fs', "utf8")
const postambleSource = fs.readFileSync(__dirname + '/postamble.fs', "utf8")

const defaultOptions = {
    // classListToString: true,
    discardLiterals: true,
    discardNamed: [],
    discardPrefix: "_"
}

function compile(grammar, options = {}) {
    options = { ...defaultOptions, options }
    const tree = metaParser.parse(grammar)
    let treeProcessed = tree.rules.map(fsharpType)
        .map(e => discardRules(e, options))
        .map(e => flattenRule(e, options))
        .flat(Infinity).filter(x => !!x)
        .map(assignNames)
    return [preambleSource,
        renderAstType(treeProcessed, options),
        renderParsingFunctions(treeProcessed, options),
        postambleSource
    ].join('\n')
}

module.exports = { compile }

// if(process.argv[2]) {
//     let grammar = fs.readFileSync(process.argv[2], 'utf8')
//     console.log(compile(grammar));
// } else {
//     console.log("USAGE npx arz file.peg")
// }
# arz
a parser generator that makes nice trees

Based on [PEG.js](https://pegjs.org/), arz is a parser generator that makes "nice" parse trees without a need to define parser actions. It uses your PEG grammar to derive a type for your syntax and parsers that produce instances of that type. The resulting parse tree has names and structure taken from your PEG grammar and should ideally not require any additional processing. Currently it outputs F# code but other languages are possible in theory.

### Usage

```
npm install --save nasser/arz
npx arz file.peg
```

This writes a standalone F# module named `Generated` to standard out.

Running with the [arithmetic PEGjs example](https://github.com/pegjs/pegjs/blob/master/examples/arithmetics.pegjs) produces [these results](https://gist.github.com/nasser/e103624176ed0274f179f87859bcb677).

### Status

Very early. I am using it for some language projects, but it may well break for you.

### Name

The goal of this parser generator is to make the nicest trees possible, so it is named after the nicest tree I know, the [Lebanese Cedar](https://en.wikipedia.org/wiki/Cedrus_libani) :lebanon:. Cedar in Arabic is أرز, pronounced *arz*.

### Legal

Copyright (c) 2020 Ramsey Nasser. Available under the [MIT license](https://github.com/nasser/arz/blob/master/LICENSE).

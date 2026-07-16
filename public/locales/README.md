These JSON files use the i18next JSON v4 format.

Plural translations use CLDR category suffixes such as `_one`, `_few`,
`_many`, and `_other`. Only include categories returned by
`Intl.PluralRules(locale).resolvedOptions().pluralCategories`. A semantic zero
message may use `_zero`; i18next selects it before the locale's normal plural
category for a count of zero.

Callers must pass a numeric `count` option for plural selection. Other
interpolation variables may be used in the message, but they do not select a
plural category.

Locale filenames with a region use canonical casing (for example `en-US.json`,
`pt-BR.json`, `pt-PT.json`, and `zh-CN.json`).

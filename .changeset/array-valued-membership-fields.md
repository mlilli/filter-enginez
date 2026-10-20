---
'@filter-enginez/core': minor
---

`InSetRule`, `InSetofSetsRule` and `HierarchicalRule` match fields that hold an array, such as
`paymentMethods: ['card', 'cash']`, so "accepts any of these payment methods" is a serializable built-in rule. A new
`arrayMatch` option chooses how the array meets the selection: `'any'` (the default) passes when at least one element is
selected, and `'all'` passes when the array holds every selected value (for `InSetofSetsRule`, a value from every
selected subset; for `HierarchicalRule`, an id in every selected subtree).

```ts
new InSetRule('paymentMethods', ['card', 'cash']); // accepts card or cash
new InSetRule('paymentMethods', ['card', 'cash'], { arrayMatch: 'all' }); // accepts both
inSet('paymentMethods', { arrayMatch: 'all', set: ['card', 'cash'] });
```

An empty selection matches everything, and an empty array matches no non-empty selection. A field that is not an array
matches exactly as in 0.0.3. A rule over an array field, which matched no item in 0.0.3, passes the items whose array
meets the selection. `arrayMatch` is saved by `exportConfig`, URL state and the worker bridge, and a value other than
`'any'` or `'all'` throws `FilterEngineRuleError` with code `RULE_INVALID_SERIALIZED_CONFIG` on load.

`applyFiltersAndQuery` reads array fields in `inSet` and `inSetOfSets` chip groups too: an item counts once toward each
candidate its array holds, however many of its elements point at that candidate. A group whose rule has
`arrayMatch: 'all'` is projected the way `containsAll` groups are, with its rule kept active, so a candidate that cannot
combine with the current selection reports `wouldBeEmpty`.

<!-- markdownlint-disable-file MD041 -->

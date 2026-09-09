# Discovery configuration

`topics.json` and `targets.json` drive what discovery looks at. Both are read by
`cg run`.

## Cost

Every post read costs $0.005 whether or not it becomes a comment, so these
queries are the main cost dial in the whole system. They are deliberately
narrow: each one pairs an operational term with an ecommerce qualifier and
excludes retweets and replies at the query level rather than paying to read
them and dropping them afterwards.

Widening a query is the fastest way to multiply the bill. `cg run` caps reads
per source and prints the cost of every run.

## `targets.json`

Empty until there is an X developer account — target discovery pulls user
timelines, which needs live credentials. Shape:

```json
[{ "xUserId": "1234567890", "username": "someone", "priority": 1,
   "category": "dtc-founder", "enabled": true, "notes": "" }]
```

`xUserId` is the numeric X id, not the handle. Handles change; ids do not.

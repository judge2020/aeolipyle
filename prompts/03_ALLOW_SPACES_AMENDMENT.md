# Aeolipyle — Allow spaces in counter names

Amends `02_PLAN.md` following the user's request on 2026-09-06:

> add a 03 file amendment and do: allow spaces in counters now

## Revised name rules

Counter names and replacement names may contain ASCII letters (`A–Z`, `a–z`),
digits (`0–9`), and ordinary ASCII spaces (`U+0020`). Apply these rules everywhere
names are accepted, including creation, lookup, increment, decrement, removal,
rename, and restoration.

- Continue trimming leading and trailing whitespace before validation.
- The trimmed name must contain 1–100 characters. Spaces count toward that limit.
- Empty and whitespace-only names are invalid.
- Preserve internal spaces, including repeated spaces, and the user's display casing.
- Identity remains the lowercased trimmed name. `Foo Bar` and `foo bar` are the
  same counter; `Foo Bar`, `Foo  Bar`, and `FooBar` are distinct names.
- Internal tabs, line breaks, non-breaking spaces, punctuation, and non-ASCII
  letters remain invalid.

The name validation expression in §7.3 becomes `/^[A-Za-z0-9 ]{1,100}$/`, applied
after trimming. Names remain safe to interpolate into Discord Markdown.

## User-facing changes

Update the invalid-name response to:

> 🚫 Counter names must be 1–100 characters: letters (A–Z), digits (0–9), and spaces.

Update the `name` and `new_name` option descriptions in English and all 30 translated
locales to mention spaces. Slash-command and option identifiers remain unchanged;
spaces are allowed in their string values. The 1–100 option length bounds remain.

## Storage and rollout

No schema migration or data rewrite is needed. Registry keys already use SQLite
TEXT, and restore buttons reference opaque UUIDs. Existing counters retain their
identities and values. Permissions, scopes, soft deletion, restore claims, and
pagination continue to follow `02_PLAN.md`.

Update the existing tests to cover spaced names, trimming, repeated spaces,
length boundaries, case-insensitive duplicates, all commands, and keep/reset
restoration. Run type checking, tests, and command-registration validation. Publish
the amendment and implementation, deploy the Worker, and re-register the localized
command descriptions with Discord. Continue to preserve `README.md` unchanged.

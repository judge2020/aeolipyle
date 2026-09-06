Plan out, in the current repository, creating a slash command discord bot.

See README.md, but we want to make a Cloudflare Workers project.

We should use durable objects for each incrementation counter (so that counters are durable and atomic).

Some commands may be sensitive - if so, they should require the user have manage channels permission, unless it's a Bot DM.

Note: counter "names" are the primary and only identifiers, and should be:
- treated case insensitively, with the original casing being maintained on future usage
- ascii numbers and letters only
- between 1 and 100 characters

Counters should be scoped to the guild in which they exist and are used/created. I.e. each guild may have the same counter but operating independently. Each user in bot DM will have their own increments.

Use emojis in outputs for that AI/vibecoded spirit.

ALL commands are to be slash commands installed globally, and with BOT_DM allowed.

Create a centralized place for locales you auto translate to (https://docs.discord.com/developers/interactions/application-commands#application-command-object-application-command-option-choice-structure) to be used when registering commands

Use https://docs.discord.com/llms.txt as needed and the official discord `discord-interactions` npm package.

Commands: 
- /removecounter - sensitive - should remove a counter and make it unavailable, as if it didn't exist. This should be a soft delete. Ephemeral failure message, non-ephemeral confirmation message.
- /addcounter - sensitive - should add a counter and make it available. If an existing counter exists, reject - but if exists and is soft deleted, ephemerally offer options (interaction buttons) between making available again at 0 count, or maintaining that past count after making available again, and an option to cancel adding counter. Ephemeral failure message, non-ephemeral confirmation message. This should also take a description.
- /counter - non-sensitive - shows current count for a counter non-ephemerally; ephemeral if none exists. Shows description.
- /counters - non-sensitive - always ephemeral, shows all counters and current increment count for each. Paginate 20 if >20.
- /increment - non-sensitive - increments by 1 non-ephemerally; ephemeral if none exists. Only shows name and new count, not description.
- /decrement - non-sensitive - decremets by 1 non-ephemerally; ephemeral if none exists. Only shows name and new count, not description.
- /renamecounter - sensitive - rename an existing counter to another name (or another casing!), non-ephemeral confirmation.

App ID: 1546275044819345408
Public Key: 8175b3666037327ad203c2da5fdf9bbfe3d565965d84348d112106b21767a530
Deploy to: aeolipyle.judge.sh
Interactions url at /interactions

Output plan to prompts/02_PLAN.md, do not work on it.

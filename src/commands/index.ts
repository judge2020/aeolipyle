import { addcounter } from "./addcounter";
import { removecounter } from "./removecounter";
import { renamecounter } from "./renamecounter";
import { counter } from "./counter";
import { counters } from "./counters";
import { increment } from "./increment";
import { decrement } from "./decrement";
import type { CommandHandler } from "./shared";
export const commands: ReadonlyMap<string, CommandHandler> = new Map(Object.entries({ addcounter, removecounter, renamecounter, counter, counters, increment, decrement }));

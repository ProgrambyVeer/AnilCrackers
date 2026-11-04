import { createInterestHandler } from './handler.ts'

Deno.serve(createInterestHandler((key) => Deno.env.get(key)))

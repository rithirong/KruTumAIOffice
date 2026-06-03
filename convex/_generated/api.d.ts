/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as agents from "../agents.js";
import type * as ai from "../ai.js";
import type * as educator from "../educator.js";
import type * as goldSignal from "../goldSignal.js";
import type * as hire from "../hire.js";
import type * as housekeeper from "../housekeeper.js";
import type * as orchestrator from "../orchestrator.js";
import type * as seed from "../seed.js";
import type * as tariq from "../tariq.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  agents: typeof agents;
  ai: typeof ai;
  educator: typeof educator;
  goldSignal: typeof goldSignal;
  hire: typeof hire;
  housekeeper: typeof housekeeper;
  orchestrator: typeof orchestrator;
  seed: typeof seed;
  tariq: typeof tariq;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};

/* eslint-disable @typescript-eslint/consistent-type-imports */
import type { NodePath } from "@babel/traverse";
import type { types as BabelTypes } from "@babel/core";
import { parse } from "@babel/parser";
import * as t from "@babel/types";
import traverseMod from "@babel/traverse";
import generateMod from "@babel/generator";

const traverse = traverseMod.default;
const generate = generateMod.default;

export { traverse, generate, parse, t };
export type { BabelTypes, NodePath };

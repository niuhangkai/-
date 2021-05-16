/* @flow */

import { baseOptions } from './options'
import { createCompiler } from 'compiler/index'
// 编译入口
const { compile, compileToFunctions } = createCompiler(baseOptions)

export { compile, compileToFunctions }

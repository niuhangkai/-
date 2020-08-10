/* @flow */

import * as nodeOps from 'web/runtime/node-ops'
import { createPatchFunction } from 'core/vdom/patch'
import baseModules from 'core/vdom/modules/index'
// 平台相关的模块
import platformModules from 'web/runtime/modules/index'

// the directive module should be applied last, after all
// built-in modules have been applied.
const modules = platformModules.concat(baseModules)

// nodeOps是一些实际的dom操作方法
// 通过函数柯里化把差异抹平
export const patch: Function = createPatchFunction({ nodeOps, modules })

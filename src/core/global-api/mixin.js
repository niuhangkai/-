/* @flow */

import { mergeOptions } from '../util/index'
// 通过mergeOptions方法，给大Vue的options挂载方法和属性
export function initMixin (Vue: GlobalAPI) {
  Vue.mixin = function (mixin: Object) {
    // 将Vue中的options和传入的options合并
    this.options = mergeOptions(this.options, mixin)
    return this
  }
}

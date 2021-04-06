/* @flow */

import { ASSET_TYPES } from 'shared/constants'
import { isPlainObject, validateComponentName } from '../util/index'

export function initAssetRegisters (Vue: GlobalAPI) {
  /**
   * Create asset registration methods.
   */
  /**
   * 遍历
   * export const ASSET_TYPES = [
      'component',
      'directive',
      'filter'
    ]
   */
  ASSET_TYPES.forEach(type => {
    // 比如Vue.component('xxx',comp),全局注册
    Vue[type] = function (
      id: string,
      definition: Function | Object
    ): Function | Object | void {
      if (!definition) {
        return this.options[type + 's'][id]
      } else {
        /* istanbul ignore if */
        // 对component组件名做一次校验
        if (process.env.NODE_ENV !== 'production' && type === 'component') {
          validateComponentName(id)
        }
        if (type === 'component' && isPlainObject(definition)) {
          definition.name = definition.name || id
          // this.options._base === Vue  这里通过Vue.extend,转化为了构造器
          definition = this.options._base.extend(definition)
        }
        if (type === 'directive' && typeof definition === 'function') {
          definition = { bind: definition, update: definition }
        }
        // 挂载到this.$options.components.组件
        this.options[type + 's'][id] = definition
        return definition
      }
    }
  })
}

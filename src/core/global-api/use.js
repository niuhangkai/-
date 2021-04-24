/* @flow */

import { toArray } from '../util/index'

export function initUse (Vue: GlobalAPI) {
  Vue.use = function (plugin: Function | Object) {
    // 定义_installedPlugins的
    const installedPlugins = (this._installedPlugins || (this._installedPlugins = []))
    // 保证插件只注册一次
    if (installedPlugins.indexOf(plugin) > -1) {
      return this
    }
    /**
     * {
     *  install(Vue) {
     *
     *  }
     * }
     */
    // additional parameters
    const args = toArray(arguments, 1)
    // 将大的vue添加到参数中
    args.unshift(this)
    // 提供了install方法执行install
    if (typeof plugin.install === 'function') {
      plugin.install.apply(plugin, args)
    } else if (typeof plugin === 'function') {
      // 否则如果plugin本身是一个function，就执行plugin函数
      plugin.apply(null, args)
    }
    installedPlugins.push(plugin)
    return this
  }
}

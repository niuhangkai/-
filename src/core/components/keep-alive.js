/* @flow */

import { isRegExp, remove } from 'shared/util'
import { getFirstComponentChild } from 'core/vdom/helpers/index'

type VNodeCache = { [key: string]: ?VNode };

function getComponentName (opts: ?VNodeComponentOptions): ?string {
  return opts && (opts.Ctor.options.name || opts.tag)
}

// 用来做匹配判断是否存在的函数
function matches (pattern: string | RegExp | Array<string>, name: string): boolean {
  if (Array.isArray(pattern)) {
    return pattern.indexOf(name) > -1
  } else if (typeof pattern === 'string') {
    return pattern.split(',').indexOf(name) > -1
  } else if (isRegExp(pattern)) {
    return pattern.test(name)
  }
  /* istanbul ignore next */
  return false
}
// include和exclude变化了重新执行这里
function pruneCache (keepAliveInstance: any, filter: Function) {
  // 获取到当前的实例中的cache对象，keys数组
  const { cache, keys, _vnode } = keepAliveInstance
  for (const key in cache) {
    const cachedNode: ?VNode = cache[key]
    // 存在缓存
    if (cachedNode) {
      const name: ?string = getComponentName(cachedNode.componentOptions)
      // name存在不满足缓存条件
      if (name && !filter(name)) {
        // 不满足条件删除
        pruneCacheEntry(cache, key, keys, _vnode)
      }
    }
  }
}
// 清理缓存，手动调用destroy清理缓存
function pruneCacheEntry (
  cache: VNodeCache,
  key: string,
  keys: Array<string>,
  current?: VNode
) {
  const cached = cache[key]
  // 当前渲染和缓存是一个时候，不执行销毁操作
  if (cached && (!current || cached.tag !== current.tag)) {
    cached.componentInstance.$destroy()
  }
  cache[key] = null
  remove(keys, key)
}

const patternTypes: Array<Function> = [String, RegExp, Array]

export default {
  name: 'keep-alive',
  abstract: true,
  // 通过props传递下来的include和exclude
  props: {
    include: patternTypes,
    exclude: patternTypes,
    // 最多可以缓存多少组件实例2.5.0新增的
    max: [String, Number]
  },

  created () {
    // 缓存vnode，缓存在内存中
    this.cache = Object.create(null)
    // 缓存对应的key值
    this.keys = []
  },

  destroyed () {
    // 遍历清除缓存
    for (const key in this.cache) {
      pruneCacheEntry(this.cache, key, this.keys)
    }
  },

  mounted () {
    // 监听include和exclude变化
    // 需要缓存的组件
    this.$watch('include', val => {
      pruneCache(this, name => matches(val, name))
    })
    // 不需要缓存的
    this.$watch('exclude', val => {
      pruneCache(this, name => !matches(val, name))
    })
  },

  render () {
    // 插槽子节点数组
    /**
     * <keep-alive>
     *  <div>13245</div>
     *  <comp-a></comp-a>
     * <keep-alive>
     */
    // slot就是上面的子节点数组
    const slot = this.$slots.default
    // 获取到插槽第一个组件节点，keep-alive只对组件节点有用，普通节点无效
    // keep-alive 要求同时只有一个子元素被渲染
    const vnode: VNode = getFirstComponentChild(slot)
    // 获取到组件的选项
    const componentOptions: ?VNodeComponentOptions = vnode && vnode.componentOptions
    if (componentOptions) {
      // check pattern
      // 获取组件名称
      const name: ?string = getComponentName(componentOptions)
      // 获取到传入的两个数组
      const { include, exclude } = this
      // 拿到当前slot组件的name和include，exclude作对比
      if (
        // not included
        // 当前组件不在include缓存列表中
        (include && (!name || !matches(include, name))) ||
        // excluded
        // 或者当前组件在exclude排除缓存列表中
        (exclude && name && matches(exclude, name))
      ) {
        // 直接返回vnode
        return vnode
      }
      // 缓存逻辑
      // cache对象以及keys数组
      const { cache, keys } = this
      // 缓存当前vnode的key，没有的话创建一个
      const key: ?string = vnode.key == null
        // same constructor may get registered as different local components
        // so cid alone is not enough (#3269)
        ? componentOptions.Ctor.cid + (componentOptions.tag ? `::${componentOptions.tag}` : '')
        : vnode.key
        // 已经被缓存
      if (cache[key]) {
        vnode.componentInstance = cache[key].componentInstance
        // make current key freshest
        // LRU（Least Recently Used：最近最少使用）
        remove(keys, key)
        keys.push(key)
      } else {
        // 第一次被渲染加入到cache对象和keys数组中
        cache[key] = vnode
        keys.push(key)
        // prune oldest entry
        // 超出了最大缓存数量
        if (this.max && keys.length > parseInt(this.max)) {
          // 做缓存清理，vnode会比较占内存，提供了max来清理
          pruneCacheEntry(cache, keys[0], keys, this._vnode)
        }
      }
      // 将当前的data中的keepAlive置为true
      vnode.data.keepAlive = true
    }
    // 返回当前的vnode
    return vnode || (slot && slot[0])
  }
}

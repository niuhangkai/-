/* @flow */

import { emptyNode } from 'core/vdom/patch'
import { resolveAsset, handleError } from 'core/util/index'
import { mergeVNodeHook } from 'core/vdom/helpers/index'

export default {
  create: updateDirectives,
  update: updateDirectives,
  destroy: function unbindDirectives (vnode: VNodeWithData) {
    updateDirectives(vnode, emptyNode)
  }
}
// 更新新老节点的指令，比如v-show
/**
 *
 *eg:

   oldVnode.data.directives = {
    expression: "name"
    name: "show"
    rawName: "v-show"
    value: true
  }
  vnode.data.directives = {
    expression: "name"
    name: "show"
    rawName: "v-show"
    value: false
  }
 */
function updateDirectives (oldVnode: VNodeWithData, vnode: VNodeWithData) {
  if (oldVnode.data.directives || vnode.data.directives) {
    // 执行更新。旧的vnode，更新时候才会有
    _update(oldVnode, vnode)
  }
}

function _update (oldVnode, vnode) {
  // 判断是不是创建
  const isCreate = oldVnode === emptyNode
  // 判断是不是销毁
  const isDestroy = vnode === emptyNode
  const oldDirs = normalizeDirectives(oldVnode.data.directives, oldVnode.context)
  const newDirs = normalizeDirectives(vnode.data.directives, vnode.context)

  const dirsWithInsert = []
  const dirsWithPostpatch = []

  let key, oldDir, dir
  // 遍历每一个指令对象
  /**
   * eg:
   * v-show:{
   *  def: {bind: ƒ, update: ƒ, unbind: ƒ}
      expression: "name"
      modifiers: {}
      name: "show"
      rawName: "v-show"
      value: false
   * }
   */
  for (key in newDirs) {
    oldDir = oldDirs[key]
    dir = newDirs[key]
    if (!oldDir) {
      // new directive, bind
      callHook(dir, 'bind', vnode, oldVnode)
      if (dir.def && dir.def.inserted) {
        dirsWithInsert.push(dir)
      }
    } else {
      // existing directive, update
      // 获取到指令绑定的新的值
      dir.oldValue = oldDir.value
      dir.oldArg = oldDir.arg
      // 执行钩子函数
      // dir是指令对象
      callHook(dir, 'update', vnode, oldVnode)
      if (dir.def && dir.def.componentUpdated) {
        dirsWithPostpatch.push(dir)
      }
    }
  }

  if (dirsWithInsert.length) {
    const callInsert = () => {
      for (let i = 0; i < dirsWithInsert.length; i++) {
        callHook(dirsWithInsert[i], 'inserted', vnode, oldVnode)
      }
    }
    if (isCreate) {
      mergeVNodeHook(vnode, 'insert', callInsert)
    } else {
      callInsert()
    }
  }

  if (dirsWithPostpatch.length) {
    mergeVNodeHook(vnode, 'postpatch', () => {
      for (let i = 0; i < dirsWithPostpatch.length; i++) {
        callHook(dirsWithPostpatch[i], 'componentUpdated', vnode, oldVnode)
      }
    })
  }

  if (!isCreate) {
    for (key in oldDirs) {
      if (!newDirs[key]) {
        // no longer present, unbind
        callHook(oldDirs[key], 'unbind', oldVnode, oldVnode, isDestroy)
      }
    }
  }
}

const emptyModifiers = Object.create(null)

// 格式化指令，定义了当前vnode中的指令的def函数
function normalizeDirectives (
  dirs: ?Array<VNodeDirective>,
  vm: Component
): { [key: string]: VNodeDirective } {
  const res = Object.create(null)
  if (!dirs) {
    // $flow-disable-line
    return res
  }
  let i, dir
  for (i = 0; i < dirs.length; i++) {
    dir = dirs[i]
    if (!dir.modifiers) {
      // $flow-disable-line
      dir.modifiers = emptyModifiers
    }
    res[getRawDirName(dir)] = dir
    // 从$options获取，在全局注册函数中，directives是挂载在$options上的
    dir.def = resolveAsset(vm.$options, 'directives', dir.name, true)
  }
  // $flow-disable-line
  return res
}
function getRawDirName (dir: VNodeDirective): string {
  return dir.rawName || `${dir.name}.${Object.keys(dir.modifiers || {}).join('.')}`
}
// eg:
/**
 *
 * def: {
 *  bind: ƒ, update: ƒ, unbind: ƒ}
    expression: "name"
    modifiers: {}
    name: "show"
    oldValue: true
    rawName: "v-show"
    value: false},

    hook="update"
 */
function callHook (dir, hook, vnode, oldVnode, isDestroy) {
  // 从当前的dir的def中找到对应的函数
  // 比如:bind,update,unbind
  const fn = dir.def && dir.def[hook]
  if (fn) {
    try {
      fn(vnode.elm, dir, vnode, oldVnode, isDestroy)
    } catch (e) {
      handleError(e, vnode.context, `directive ${dir.name} ${hook} hook`)
    }
  }
}

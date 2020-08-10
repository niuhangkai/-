/* @flow */

import config from 'core/config'
import { warn, cached } from 'core/util/index'
import { mark, measure } from 'core/util/perf'

import Vue from './runtime/index'
import { query } from './util/index'
import { compileToFunctions } from './compiler/index'
import { shouldDecodeNewlines, shouldDecodeNewlinesForHref } from './util/compat'

const idToTemplate = cached(id => {
  const el = query(id)
  return el && el.innerHTML
})

const mount = Vue.prototype.$mount
Vue.prototype.$mount = function (
  el?: string | Element,
  hydrating?: boolean
): Component {
  el = el && query(el)

  /* istanbul ignore if */
  if (el === document.body || el === document.documentElement) {
    process.env.NODE_ENV !== 'production' && warn(
      `Do not mount Vue to <html> or <body> - mount to normal elements instead.`
    )
    return this
  }

  const options = this.$options
  // resolve template/el and convert to render function
  // 组件中有render函数不会执行这里，直接执行mount.call方法
  if (!options.render) {
    let template = options.template
    if (template) {
      if (typeof template === 'string') {
        if (template.charAt(0) === '#') {
          template = idToTemplate(template)
          /* istanbul ignore if */
          if (process.env.NODE_ENV !== 'production' && !template) {
            warn(
              `Template element not found or is empty: ${options.template}`,
              this
            )
          }
        }
      } else if (template.nodeType) {
        // nodeType 属性返回以数字值返回指定节点的节点类型。
        // 如果节点是元素节点，则 nodeType 属性将返回 1。
        // 如果节点是属性节点，则 nodeType 属性将返回 2。
        template = template.innerHTML
      } else {
        if (process.env.NODE_ENV !== 'production') {
          warn('invalid template option:' + template, this)
        }
        return this
      }
    } else if (el) {
      template = getOuterHTML(el)
    }
    if (template) {
      /* istanbul ignore if */
      if (process.env.NODE_ENV !== 'production' && config.performance && mark) {
        mark('compile')
      }
      // compileToFunctions 将template编译为render函数
      const { render, staticRenderFns } = compileToFunctions(template, {
        // 输出错误标记范围提示
        outputSourceRange: process.env.NODE_ENV !== 'production',
        // 处理浏览器兼容
        shouldDecodeNewlines,
        shouldDecodeNewlinesForHref,
        // Mustache语法会被替换
        delimiters: options.delimiters,
        // 设置为true，注释节点会被保留
        comments: options.comments
      }, this)
      options.render = render
      options.staticRenderFns = staticRenderFns


      /* istanbul ignore if */
      if (process.env.NODE_ENV !== 'production' && config.performance && mark) {
        mark('compile end')
        measure(`vue ${this._name} compile`, 'compile', 'compile end')
      }
    }
  }
  return mount.call(this, el, hydrating)
}

/**
 * Get outerHTML of elements, taking care
 * of SVG elements in IE as well.
 */
function getOuterHTML (el: Element): string {
  // 属性获取描述元素（包括其后代）的序列化HTML片段
  // 和innerHTML区别为：innerHTML获取标签之间的HTML，outerHTML获取对象及其内容的HTML
  if (el.outerHTML) {
    return el.outerHTML
  } else {
    // IE中的svg为undefined另外处理
    const container = document.createElement('div')
    container.appendChild(el.cloneNode(true))
    return container.innerHTML
  }
}

Vue.compile = compileToFunctions

export default Vue

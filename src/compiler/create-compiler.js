/* @flow */

import { extend } from 'shared/util'
import { detectErrors } from './error-detector'
import { createCompileToFunctionFn } from './to-function'
// 创建一个编译器
export function createCompilerCreator (baseCompile: Function): Function {
  return function createCompiler (baseOptions: CompilerOptions) {
     /**
   * 这里的参数是
   * compileToFunctions(template, {
        // 输出错误标记范围提示
        outputSourceRange: process.env.NODE_ENV !== 'production',
        // 处理浏览器兼容
        shouldDecodeNewlines,
        shouldDecodeNewlinesForHref,
        // Mustache语法会被替换
        delimiters: options.delimiters,
        // 设置为true，注释节点会被保留
        comments: options.comments
      },this)
   */
    function compile (
      template: string,
      options?: CompilerOptions
    ): CompiledResult {
      // baseOptions是src\platforms\web\compiler\options.js下面的
      const finalOptions = Object.create(baseOptions)
      // 定义错误的errors
      const errors = []
      // 定义tip数组
      const tips = []

      let warn = (msg, range, tip) => {
        (tip ? tips : errors).push(msg)
      }

      if (options) {
        if (process.env.NODE_ENV !== 'production' && options.outputSourceRange) {
          // $flow-disable-line
          const leadingSpaceLength = template.match(/^\s*/)[0].length

          warn = (msg, range, tip) => {
            const data: WarningMessage = { msg }
            if (range) {
              if (range.start != null) {
                data.start = range.start + leadingSpaceLength
              }
              if (range.end != null) {
                data.end = range.end + leadingSpaceLength
              }
            }
            (tip ? tips : errors).push(data)
          }
        }
        // 将baseOptions和options合并
        // merge custom modules
        if (options.modules) {
          finalOptions.modules =
            (baseOptions.modules || []).concat(options.modules)
        }
        // merge custom directives
        if (options.directives) {
          finalOptions.directives = extend(
            Object.create(baseOptions.directives || null),
            options.directives
          )
        }
        // copy other options
        for (const key in options) {
          if (key !== 'modules' && key !== 'directives') {
            finalOptions[key] = options[key]
          }
        }
      }

      finalOptions.warn = warn
      // 这里开始做真正的编译
      const compiled = baseCompile(template.trim(), finalOptions)
      if (process.env.NODE_ENV !== 'production') {
        detectErrors(compiled.ast, warn)
      }
      compiled.errors = errors
      compiled.tips = tips
      return compiled
    }

    return {
      compile,
      // 这里是实际执行的函数
      compileToFunctions: createCompileToFunctionFn(compile)
    }
  }
}

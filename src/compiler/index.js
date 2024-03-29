/* @flow */

import { parse } from './parser/index'
import { optimize } from './optimizer'
import { generate } from './codegen/index'
import { createCompilerCreator } from './create-compiler'

// `createCompilerCreator` allows creating compilers that use alternative
// parser/optimizer/codegen, e.g the SSR optimizing compiler.
// Here we just export a default compiler using the default parts.
// 这里的baseCompile是真正执行编译的开始，在此之前，做了环境判断。缓存template，errors处理，合并处理options
// 编译之后，又会对编译好的errors做处理，之后还需要将转换后的字符串代码转换为函数，并且缓存
/**
 *
 *
 * 编译分为三步
 * 1.创建生成ast
 * 2.优化ast
 * 3.将ast转换为代码
 *   */
/**
 *
 * 1.新的二进制格式，
 *
 *
 *
 *
 *
 */
export const createCompiler = createCompilerCreator(function baseCompile (
  template: string,
  options: CompilerOptions
): CompiledResult {
  // 生成ast
  /**
   * ast：抽象语法树，babel，eslint，prettier都是通过ast实现的
   * {
   * attrList:[]
   * attrsMap:{id:app}
   * children:[{
   *    alias: "item"
        attrsList: []
        attrsMap: {v-for: "(item,index) in list", v-if: "index > 2"}
        children: [{…}]
        end: 165
        for: "list"
        if: "index > 2",
        ifConditions:[{xxx}]
      }],
   * if:"isShow",
   * classBinding:"bindCls",
   * parent:undefined
   * tag:"ul",
   * ifConditions:[{xxx}]
   * }
   */
  const ast = parse(template.trim(), options)
  if (options.optimize !== false) {
    // 优化ast，主要是对纯静态节点的标记
    optimize(ast, options)
  }
  // 生成代码，将ast转换为代码字符串
  // 第一个参数是优化好的纯静态节点的标记ast
  const code = generate(ast, options)
  return {
    ast,
    render: code.render,
    staticRenderFns: code.staticRenderFns
  }
})

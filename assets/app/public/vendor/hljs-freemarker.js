/**
 * FreeMarker Template Language (FTL) highlight.js language definition
 * Supports: directives (<#...> </#...>), interpolations (${...} #{...}),
 * comments (<#-- ... -->), and embedded HTML/XML.
 */
(function () {
  if (typeof hljs === 'undefined') return;

  /** Nested expression helper — handles ${...} and #{...} inside attributes */
  function freemarker(hljs) {
    const INTERPOLATION = {
      className: 'template-variable',
      begin: /\$\{/,
      end: /\}/,
      contains: [
        hljs.QUOTE_STRING_MODE,
        hljs.APOS_STRING_MODE,
        hljs.C_NUMBER_MODE,
        {
          begin: /\[/,
          end: /\]/,
        },
      ],
    };

    const NUMERIC_INTERPOLATION = {
      className: 'template-variable',
      begin: /#\{/,
      end: /\}/,
    };

    // FreeMarker directive tag: <#foo ...> </#foo> <@foo ...> </@foo>
    const DIRECTIVE = {
      className: 'template-tag',
      begin: /<[#@][a-zA-Z_][a-zA-Z0-9_.]*/,
      end: />/,
      contains: [
        INTERPOLATION,
        NUMERIC_INTERPOLATION,
        hljs.QUOTE_STRING_MODE,
        hljs.APOS_STRING_MODE,
        hljs.C_NUMBER_MODE,
        {
          // named parameters: foo= 
          className: 'attr',
          begin: /[a-zA-Z_][a-zA-Z0-9_]*/,
          end: /(?==)/,
          excludeEnd: true,
        },
      ],
    };

    const CLOSING_DIRECTIVE = {
      className: 'template-tag',
      begin: /<\/[#@][a-zA-Z_][a-zA-Z0-9_.]*/,
      end: />/,
    };

    // <#-- FreeMarker comment -->
    const FTL_COMMENT = {
      className: 'comment',
      begin: /<#--/,
      end: /-->/,
      relevance: 10,
    };

    // HTML tag (simplified, so FTL directives are parsed first)
    const HTML_ATTR = {
      begin: /[a-zA-Z_:][a-zA-Z0-9_:\-.]*/,
      className: 'attr',
    };

    const HTML_QUOTED_VALUE = {
      className: 'string',
      begin: /"/,
      end: /"/,
      contains: [INTERPOLATION, NUMERIC_INTERPOLATION],
    };

    const HTML_APOS_VALUE = {
      className: 'string',
      begin: /'/,
      end: /'/,
      contains: [INTERPOLATION, NUMERIC_INTERPOLATION],
    };

    const HTML_TAG = {
      className: 'tag',
      begin: /<\/?[a-zA-Z][a-zA-Z0-9]*/,
      end: /\/?>/,
      contains: [
        HTML_ATTR,
        HTML_QUOTED_VALUE,
        HTML_APOS_VALUE,
        INTERPOLATION,
        NUMERIC_INTERPOLATION,
      ],
    };

    return {
      name: 'FreeMarker',
      aliases: ['ftl', 'freemarker'],
      case_insensitive: true,
      contains: [
        FTL_COMMENT,
        DIRECTIVE,
        CLOSING_DIRECTIVE,
        INTERPOLATION,
        NUMERIC_INTERPOLATION,
        HTML_TAG,
        // HTML comment
        {
          className: 'comment',
          begin: /<!--/,
          end: /-->/,
          relevance: 10,
        },
        // DOCTYPE
        {
          className: 'meta',
          begin: /<!DOCTYPE/,
          end: />/,
          relevance: 10,
        },
      ],
    };
  }

  hljs.registerLanguage('freemarker', freemarker);
  hljs.registerLanguage('ftl', freemarker);
})();

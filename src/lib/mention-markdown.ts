import type { MarkedExtension } from "marked";

const MENTION_RE =
  /@((?:[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+[a-zA-Z]{2,})/;

export function mentionExtension(): MarkedExtension {
  return {
    extensions: [
      {
        name: "mention",
        level: "inline",
        start(src: string) {
          return src.indexOf("@");
        },
        tokenizer(src: string) {
          const match = MENTION_RE.exec(src);
          if (match && match.index === 0) {
            return {
              type: "mention",
              raw: match[0],
              handle: match[1],
            };
          }
          return undefined;
        },
        renderer(token) {
          const handle = (token as unknown as { handle: string }).handle;
          return `<span class="mention">@${handle}</span>`;
        },
      },
    ],
  };
}

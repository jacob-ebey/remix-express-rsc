import Markdown from "markdown-to-jsx";
import { useLoaderData } from "react-router";

export function loader() {
  const markdown = `
# Hello, world!

This is a markdown file.
  `;
  return (
    <div className="prose lg:prose-xl">
      <Markdown>{markdown}</Markdown>
    </div>
  );
}

export default function MarkdownRoute() {
  return useLoaderData() as ReturnType<typeof loader>;
}

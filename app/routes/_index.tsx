import type { MetaFunction } from "@react-router/node";
import { useLoaderData } from "react-router";

// import { Counter } from "~/components/counter"

export const meta: MetaFunction = () => {
  return [
    { title: "Home" },
    { name: "description", content: "Welcome to React Router!" },
  ];
};

export function loader() {
  return <h1 className="from-loader">Home page</h1>;
}

export default function Index() {
  return (
    <div style={{ fontFamily: "system-ui, sans-serif", lineHeight: "1.8" }}>
      {useLoaderData() as ReturnType<typeof loader>}
    </div>
  );
}

import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
} from "@react-router/node";
import { createCookie, redirect } from "@react-router/node";
import { useActionData, useLoaderData } from "react-router";

import { LoginForm, LogoutForm } from "./form";

const cookie = createCookie("user", {
  httpOnly: true,
  path: "/",
  sameSite: "lax",
});

export async function action({ request, response }: ActionFunctionArgs) {
  const formData = await request.formData();

  if (formData.get("intent") === "logout") {
    throw redirect("/", {
      headers: {
        "Set-Cookie": await cookie.serialize(""),
      },
    });
  }

  let error: string | undefined;

  const email = formData.get("email");
  const password = formData.get("password");

  if (
    !email ||
    !password ||
    typeof email !== "string" ||
    typeof password !== "string" ||
    !password.trim()
  ) {
    error = "Enter a valid email and password.";
  } else {
    throw redirect("/", {
      headers: {
        "Set-Cookie": await cookie.serialize(email),
      },
    });
  }

  if (response && error) {
    response.status = 401;
  }
  return <LoginForm error={error} />;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const email = await cookie.parse(request.headers.get("Cookie"));

  if (email) {
    return <LogoutForm />;
  }

  return <LoginForm />;
}

export default function Index() {
  const actionData = useActionData() as ReturnType<typeof action> | undefined;
  const loaderData = useLoaderData() as ReturnType<typeof loader>;
  return (
    <>
      <title>Home</title>
      <meta name="description" content="Welcome to React Router!" />
      {actionData || loaderData}
    </>
  );
}

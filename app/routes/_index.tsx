import type { MetaFunction } from "@react-router/node";
import { Link, useLoaderData } from "react-router";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const meta: MetaFunction = () => {
  return [
    { title: "Home" },
    { name: "description", content: "Welcome to React Router!" },
  ];
};

export function loader() {
  const name = "world";
  return (
    <form
      className="w-full h-screen flex items-center justify-center px-4"
      action={(formData) => {
        "use server";
        console.log(`Hello, ${name}!`);
      }}
    >
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-2xl">Login</CardTitle>
          <CardDescription>
            Enter your email below to login to your account.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              name="email"
              placeholder="m@example.com"
              autoComplete="current-email"
              required
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              name="password"
              type="password"
              placeholder="********"
              autoComplete="current-password"
              required
            />
          </div>
        </CardContent>
        <CardFooter>
          <div className="w-full gap-2">
            <Button type="submit" className="w-full block">
              Sign in
            </Button>
            <p>
              Don't have an account?{" "}
              <a href="/signup" className="underline">
                Sign up
              </a>
            </p>
          </div>
        </CardFooter>
      </Card>
    </form>
  );
}

export default function Index() {
  return useLoaderData() as ReturnType<typeof loader>;
}

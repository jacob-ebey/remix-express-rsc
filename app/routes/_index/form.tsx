"use client";
import { Form } from "react-router";

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

export function LoginForm({ error }: { error?: string }) {
  return (
    <Form
      method="post"
      className="w-full h-screen flex items-center justify-center px-4"
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
            {error && <p className="text-red-500 text-sm">{error}</p>}
          </div>
        </CardContent>
        <CardFooter>
          <Button type="submit" className="w-full block">
            Sign in
          </Button>
        </CardFooter>
      </Card>
    </Form>
  );
}

export function LogoutForm() {
  return (
    <Form
      method="post"
      className="w-full h-screen flex items-center justify-center px-4"
    >
      <input type="hidden" name="intent" value="logout" />
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-2xl">Logout</CardTitle>
        </CardHeader>
        <CardFooter>
          <div className="w-full gap-2">
            <Button type="submit" className="w-full block">
              Logout
            </Button>
          </div>
        </CardFooter>
      </Card>
    </Form>
  );
}

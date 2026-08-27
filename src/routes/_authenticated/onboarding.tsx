import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  GENDER_LABELS,
  INTEREST_OPTIONS,
  type GenderType,
} from "@/types/models";
import {
  checkUsername,
  completeProfile,
  getMyProfile,
} from "@/lib/profile.functions";

export const Route = createFileRoute("/_authenticated/onboarding")({
  head: () => ({
    meta: [
      { title: "Set up your Lume profile" },
      {
        name: "description",
        content:
          "Add your name, username and interests so Lume can match you with the right people.",
      },
      { property: "og:title", content: "Set up your Lume profile" },
      {
        property: "og:description",
        content: "Complete your Lume profile to start matching.",
      },
    ],
  }),
  component: Onboarding,
});

function Onboarding() {
  const navigate = useNavigate();
      
  const { data: profile } = useQuery({
    queryKey: ["my-profile"],
    queryFn: () => getMyProfile(),
  });

  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [dob, setDob] = useState("");
  const [gender, setGender] = useState<GenderType | "">("");
  const [country, setCountry] = useState("");
  const [bio, setBio] = useState("");
  const [interests, setInterests] = useState<string[]>([]);
  const [nameState, setNameState] = useState<
    "idle" | "checking" | "ok" | "taken" | "invalid"
  >("idle");

  useEffect(() => {
    if (!profile) return;
    setDisplayName((v) => v || profile.display_name || "");
    setUsername((v) => v || profile.username || "");
    if (profile.profile_completed) navigate({ to: "/lobby", replace: true });
  }, [profile, navigate]);

  useEffect(() => {
    const value = username.trim().toLowerCase();
    if (value.length < 3) {
      setNameState(value.length ? "invalid" : "idle");
      return;
    }
    setNameState("checking");
    const t = setTimeout(async () => {
      try {
        const res = await checkUsername({ data: { username: value } });
        setNameState(
          res.available ? "ok" : res.reason === "invalid" ? "invalid" : "taken",
        );
      } catch {
        setNameState("idle");
      }
    }, 400);
    return () => clearTimeout(t);
  }, [username]);

  const mutation = useMutation({
    mutationFn: async () =>
      completeProfile({
        data: {
          display_name: displayName.trim(),
          username: username.trim().toLowerCase(),
          date_of_birth: dob,
          gender: gender as GenderType,
          country: country.trim(),
          bio: bio.trim(),
          interests,
        },
      }),
    onSuccess: () => {
      toast.success("Profile ready — let's find you someone.");
      navigate({ to: "/lobby", replace: true });
    },
    onError: (e: Error) =>
      toast.error(e.message || "Could not save your profile."),
  });

  const toggleInterest = (value: string) =>
    setInterests((prev) =>
      prev.includes(value)
        ? prev.filter((i) => i !== value)
        : prev.length >= 8
          ? prev
          : [...prev, value],
    );

  const ready =
    displayName.trim().length >= 2 &&
    nameState === "ok" &&
    !!dob &&
    !!gender &&
    country.trim().length >= 2;

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto w-full max-w-md px-6 py-10 safe-top safe-bottom">
        <h1 className="text-3xl font-bold text-foreground">Your profile</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This is what other members see. Your date of birth stays private —
          it's only used for the 18+ check.
        </p>

        <div className="mt-8 space-y-5">
          <div className="space-y-2">
            <Label htmlFor="display-name">Display name</Label>
            <Input
              id="display-name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Alex"
              className="h-12 rounded-xl"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="username">Username</Label>
            <Input
              id="username"
              value={username}
              onChange={(e) => setUsername(e.target.value.toLowerCase())}
              placeholder="alex_92"
              className="h-12 rounded-xl"
            />
            <p
              className={cn(
                "text-xs",
                nameState === "ok" ? "text-success" : "text-muted-foreground",
                (nameState === "taken" || nameState === "invalid") &&
                  "text-destructive",
              )}
            >
              {nameState === "checking" && "Checking availability…"}
              {nameState === "ok" && "Available"}
              {nameState === "taken" && "That username is taken"}
              {nameState === "invalid" &&
                "3–20 characters: lowercase letters, numbers, underscore"}
              {nameState === "idle" &&
                "3–20 characters: lowercase letters, numbers, underscore"}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="dob">Date of birth</Label>
            <Input
              id="dob"
              type="date"
              value={dob}
              onChange={(e) => setDob(e.target.value)}
              className="h-12 rounded-xl"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="gender">Gender</Label>
            <Select
              value={gender}
              onValueChange={(v) => setGender(v as GenderType)}
            >
              <SelectTrigger id="gender" className="h-12 rounded-xl">
                <SelectValue placeholder="Select" />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(GENDER_LABELS) as GenderType[]).map((key) => (
                  <SelectItem key={key} value={key}>
                    {GENDER_LABELS[key]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="country">Country</Label>
            <Input
              id="country"
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              placeholder="Philippines"
              className="h-12 rounded-xl"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="bio">Bio</Label>
            <Textarea
              id="bio"
              value={bio}
              onChange={(e) => setBio(e.target.value.slice(0, 200))}
              placeholder="A line about you…"
              className="min-h-24 rounded-xl"
            />
            <p className="text-xs text-muted-foreground">{bio.length}/200</p>
          </div>

          <div className="space-y-2">
            <Label>Interests</Label>
            <div className="flex flex-wrap gap-2">
              {INTEREST_OPTIONS.map((option) => {
                const active = interests.includes(option);
                return (
                  <button
                    key={option}
                    type="button"
                    onClick={() => toggleInterest(option)}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors",
                      active
                        ? "border-primary bg-primary/15 text-foreground"
                        : "border-border bg-surface text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {active && <Check className="size-3.5 text-primary" />}
                    {option}
                  </button>
                );
              })}
            </div>
          </div>

          <Button
            size="lg"
            disabled={!ready || mutation.isPending}
            onClick={() => mutation.mutate()}
            className="ember-lift h-14 w-full rounded-2xl text-base"
          >
            {mutation.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              "Finish setup"
            )}
          </Button>
        </div>
      </div>
    </main>
  );
}

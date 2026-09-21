import { Command, CommandExecutor } from "@effect/platform";
import { NodeContext } from "@effect/platform-node";
import { Data, Effect, Layer, Option } from "effect";

export class MacIdentityError extends Data.TaggedError("MacIdentityError")<{
  readonly cause: unknown;
}> {}

export const parseHardwareUuid = (text: string): Option.Option<string> => {
  const hit = text.split("\n").find((l) => l.includes("IOPlatformUUID"));
  if (hit === undefined) {
    return Option.none();
  }
  const uuid = hit.split('"')[3];
  return uuid === undefined ? Option.none() : Option.some(uuid);
};

export class MacIdentity extends Effect.Service<MacIdentity>()("MacIdentity", {
  effect: Effect.gen(function* () {
    const executor = yield* CommandExecutor.CommandExecutor;
    const run = (command: Command.Command) =>
      Command.string(command).pipe(
        Effect.mapError((cause) => new MacIdentityError({ cause })),
        Effect.provideService(CommandExecutor.CommandExecutor, executor),
      );
    return {
      name: run(Command.make("scutil", "--get", "ComputerName")).pipe(
        Effect.map((s) => s.trim()),
      ),
      hardwareUuid: run(
        Command.make("ioreg", "-rd1", "-c", "IOPlatformExpertDevice"),
      ).pipe(
        Effect.flatMap((text) =>
          Option.match(parseHardwareUuid(text), {
            onNone: () =>
              Effect.fail(
                new MacIdentityError({ cause: "IOPlatformUUID not found" }),
              ),
            onSome: Effect.succeed,
          }),
        ),
      ),
    };
  }),
  dependencies: [NodeContext.layer],
}) {
  // biome-ignore lint/style/useNamingConvention: layers are PascalCase
  static Test = Layer.succeed(
    this,
    new MacIdentity({
      name: Effect.succeed("Studio"),
      hardwareUuid: Effect.succeed("01234567-89AB-CDEF-0123-456789ABCDEF"),
    }),
  );
}

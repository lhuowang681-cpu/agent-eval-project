export interface FormatCommandResultParams {
  error?: string;
  exitCode?: number;
  shellId?: string;
  stderr?: string;
  stdout?: string;
  success: boolean;
}

export const formatCommandResult = ({
  success,
  shellId,
  error,
  stdout,
  stderr,
  exitCode,
}: FormatCommandResultParams): string => {
  const parts: string[] = [];

  // `success` is the envelope ("service responded"); `exitCode` is the command
  // itself. Treat a non-zero exit as failure regardless of envelope success, so
  // we never render "Command completed successfully." over a 137/130/etc.
  const hasNonZeroExit = exitCode !== undefined && exitCode !== 0;
  const failed = !success || hasNonZeroExit;

  if (failed) {
    // Merge the exit code and the spawn-level error into a single header instead
    // of a trailing `Exit code:` line. `error` is absent on a plain non-zero
    // exit, so guard it to avoid emitting "Command failed: undefined".
    let header = 'Command failed';
    if (hasNonZeroExit) header += ` with exit code ${exitCode}`;
    if (error) header += `: ${error}`;
    parts.push(header);
  } else if (shellId) {
    parts.push(`Command started in background with shell_id: ${shellId}`);
  } else if (stderr && stderr.trim()) {
    // Exit code 0 but the command also wrote to stderr. Don't claim outright
    // success: a chained script can exit 0 while an earlier step failed (e.g.
    // `cd missing && cat > f` short-circuits, yet a trailing echo still exits 0),
    // and the model must not treat that as "done". Point it at stderr to verify.
    parts.push(
      'Command exited with code 0, but also wrote to stderr — review the Stderr below and verify it actually did what you intended before continuing.',
    );
  } else {
    parts.push('Command completed successfully.');
  }

  if (stdout) parts.push(`Output:\n${stdout}`);
  if (stderr) parts.push(`Stderr:\n${stderr}`);

  return parts.join('\n\n');
};

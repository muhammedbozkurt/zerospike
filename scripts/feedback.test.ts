/**
 * Standalone, dependency-free harness for the feedback overlay rules. No jest;
 * compile + run with node:
 *
 *   npx tsc scripts/feedback.test.ts lib/feedback.ts --ignoreConfig \
 *     --outDir .tmp --module commonjs --target es2019 \
 *     --moduleResolution bundler --skipLibCheck --esModuleInterop \
 *   && node .tmp/scripts/feedback.test.js
 *
 * Two rules are locked down here:
 *
 *  1. Exactly one host paints, and it is always the most recently registered
 *     one. A dialog painted by any other host would sit underneath the screen
 *     the user is actually looking at (the R3 11.1 bug).
 *
 *  2. A dialog's buttons stack once a label outgrows half the dialog. The
 *     literals below are the real translations, so a future translation edit
 *     that would overflow a button fails here (the R3 11.3 bug).
 */

// Minimal ambient decls so we need no @types/node / dom lib.
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void };

import {
  activeHostId,
  popHost,
  pushHost,
  shouldStackButtons,
} from "../lib/feedback";

let failures = 0;

function eq(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`  ok   ${name}`);
  } else {
    failures++;
    console.log(`  FAIL ${name}: expected ${e}, got ${a}`);
  }
}

console.log("feedback host stack");

// Nothing mounted yet: no host, and no owner to attribute a dialog to.
eq("empty stack has no active host", activeHostId([]), null);

// The root layout's host serves the tabs and every non-modal route.
const root = pushHost([], 0);
eq("root host alone is active", activeHostId(root), 0);

// Opening a modal screen (e.g. scan) hands the overlays to that screen.
const withScan = pushHost(root, 1);
eq("stack after opening a modal screen", withScan, [0, 1]);
eq("newest host wins", activeHostId(withScan), 1);

// Stacking a second modal (e.g. paywall over add-food) hands them on again.
const withPaywall = pushHost(withScan, 2);
eq("topmost of three is active", activeHostId(withPaywall), 2);

// Closing the top screen returns the overlays to the one underneath.
eq("closing the top host falls back", activeHostId(popHost(withPaywall, 2)), 1);

// router.replace mounts the new screen before the old one unmounts, so the
// departing host is NOT on top. Removing it must not disturb the painter.
const replaced = popHost(withPaywall, 1);
eq("removing a middle host keeps the stack ordered", replaced, [0, 2]);
eq("removing a middle host does not change the painter", activeHostId(replaced), 2);

// Closing every modal screen returns to the root host, never to "no host".
eq("back to root", activeHostId(popHost(popHost(withPaywall, 2), 1)), 0);

// Unregistering an id that was never registered is a no-op, not a corruption.
eq("unknown id is a no-op", popHost(withScan, 99), [0, 1]);

console.log("\ndialog button layout");

// Every Cancel/Confirm and Cancel/Delete pair in the app, in all five
// languages. These must all fit side by side; stacking them would be ugly.
const SHORT_PAIRS: [string, string][] = [
  ["Onayla", "İptal"], // tr
  ["Sil", "İptal"],
  ["Confirm", "Cancel"], // en
  ["Delete", "Cancel"],
  ["Bestätigen", "Abbrechen"], // de, the longest of them at 10
  ["Löschen", "Abbrechen"],
  ["Confirmar", "Cancelar"], // es
  ["Eliminar", "Cancelar"],
  ["Confirmer", "Annuler"], // fr
  ["Supprimer", "Annuler"],
  ["Temizle", "İptal"], // dashboard sample-data clear
  ["Clear", "Cancel"],
];
for (const [confirmLabel, cancelLabel] of SHORT_PAIRS) {
  eq(
    `"${confirmLabel}" / "${cancelLabel}" share a row`,
    shouldStackButtons(confirmLabel, cancelLabel),
    false
  );
}

// The scanner's "not found" dialog, the pair that started this. Every language
// must stack; German and French are 32 characters.
const SCAN_PAIRS: [string, string][] = [
  ["Yeni Yemek Olarak Kaydet", "Tekrar Tara"], // tr, 24
  ["Save as New Food", "Scan Again"], // en, 16
  ["Als neues Lebensmittel speichern", "Erneut scannen"], // de, 32
  ["Guardar como nuevo alimento", "Escanear de nuevo"], // es, 27
  ["Enregistrer comme nouvel aliment", "Scanner à nouveau"], // fr, 32
];
for (const [confirmLabel, cancelLabel] of SCAN_PAIRS) {
  eq(`"${confirmLabel}" stacks`, shouldStackButtons(confirmLabel, cancelLabel), true);
}

// A long label on either side is enough to stack the pair.
eq("a long cancel label also stacks", shouldStackButtons("OK", "Scanner à nouveau"), true);
eq("exactly at the limit shares a row", shouldStackButtons("123456789012", "OK"), false);
eq("one past the limit stacks", shouldStackButtons("1234567890123", "OK"), true);

console.log(failures === 0 ? "\nall passed" : `\n${failures} failed`);
process.exit(failures === 0 ? 0 : 1);

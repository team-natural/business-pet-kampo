// The transfer destination, read from env rather than a constant so staging cannot print the
// production account and invite a real transfer into it (D-039).
//
// Not a secret — it is printed on the order confirmation screen and in the reminder mail — so it
// lives in wrangler.jsonc's `vars`, not in Workers Secrets (DEV-10 §1-3).
export interface BankAccountEnv {
  BANK_NAME?: string;
  BANK_BRANCH?: string;
  BANK_ACCOUNT_TYPE?: string;
  BANK_ACCOUNT_NUMBER?: string;
  BANK_ACCOUNT_HOLDER?: string;
}

export interface BankAccount {
  bankName: string;
  branch: string;
  accountType: string;
  accountNumber: string;
  accountHolder: string;
}

// Null when any of the five is missing, and every caller renders nothing rather than a half-filled
// block. A partial account is worse than none: a transfer sent against it does not arrive, and the
// buyer believes they have paid (GOV-01 D-036 applies the same rule to OAuth).
export function readBankAccount(env: BankAccountEnv): BankAccount | null {
  const account = {
    bankName: env.BANK_NAME,
    branch: env.BANK_BRANCH,
    accountType: env.BANK_ACCOUNT_TYPE,
    accountNumber: env.BANK_ACCOUNT_NUMBER,
    accountHolder: env.BANK_ACCOUNT_HOLDER,
  };

  return Object.values(account).every((value) => typeof value === "string" && value.length > 0) ? (account as BankAccount) : null;
}

// Printed next to the account on both the screen and the mail. Without it the operator cannot tell
// which order a transfer belongs to — company transfers arrive under an accounting department's
// name, not the buyer's (D-039).
export const transferReferenceNote = (orderNumber: string) => `お振込の際は、振込依頼人名の先頭に注文番号「${orderNumber}」をご入力ください。`;

"use client";

import { useState, type ReactNode } from "react";
import { LabelChip, StateRing } from "@yinglong/ui";
import type { ProofBundle } from "@/lib/api/view";
import { LEDGER_SHORT, shortHash } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { TwinRings } from "./charts";
import { Note, ScrollTable } from "./parts";

const Num = ({ children }: { children: ReactNode }) => <span className="font-mono text-fg-0 tabular-nums">{children}</span>;

/** "Same code on both blockchains": the server's bytecode comparison, drawn, and the contracts behind it. */
export function ChainSection({ chain }: { chain: ProofBundle["chain"] }) {
  const [all, setAll] = useState(false);
  const { ledgers, bytecode, pairs } = chain;
  const enforcers = pairs.filter((p) => p.enforcer);
  const both = pairs.filter((p) => p.identical !== null);
  const enfBoth = enforcers.filter((p) => p.identical !== null);
  const enfSame = enfBoth.filter((p) => p.identical).length;
  const shown = all || !enforcers.length ? pairs : enforcers;
  const hidden = pairs.length - shown.length;
  const hiddenDiffer = pairs.filter((p) => !shown.includes(p) && p.identical === false).length;

  return (
    <div className="grid gap-6">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_400px] lg:items-center">
        <div className="grid gap-3">
          <p className="m-0 max-w-[60ch] text-15 text-fg-1">
            {bytecode ? (
              <>
                <Num>{bytecode.identical}</Num> of <Num>{bytecode.compared}</Num> contracts deployed on both blockchains run byte-for-byte identical code
                {enfBoth.length ? (
                  <>
                    ; <Num>{enfSame}</Num> of <Num>{enfBoth.length}</Num> YINGLONG rule enforcers.
                  </>
                ) : (
                  "."
                )}
              </>
            ) : (
              "The server did not report a bytecode comparison."
            )}
          </p>
          <div className="flex flex-wrap gap-2">
            {ledgers.map((l) => (
              <LabelChip key={l.ledger} tone="steel" title={l.label}>
                {l.label}
                {l.chainId !== null ? ` · chain id ${l.chainId}` : ""}
                {!l.deployed ? " · not deployed" : ""}
              </LabelChip>
            ))}
          </div>
          {bytecode && bytecode.differ.length ? (
            <Note>
              The {bytecode.differ.length} that differ ({bytecode.differ.join(", ")}) are framework contracts whose constructors take chain-specific values. Every rule enforcer is compared by its runtime bytecode hash.
            </Note>
          ) : null}
          <Note>Equality is computed on this page from the code hashes the server published, not asserted by it.</Note>
        </div>
        {both.length ? <TwinRings pairs={pairs} ledgers={ledgers} /> : null}
      </div>

      {pairs.length ? (
        <ScrollTable label="Contracts on both ledgers (scrolls sideways on small screens)" minWidth={760}>
          <thead>
            <tr>
              <th scope="col">Contract</th>
              <th scope="col">Code</th>
              {ledgers.map((l) => (
                <th key={l.ledger} scope="col">
                  {LEDGER_SHORT[l.ledger]} address
                </th>
              ))}
              <th scope="col">Code hash</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((p) => (
              <tr key={p.name}>
                <td className="text-fg-1">
                  <span className="font-mono text-12">{p.name}</span>
                  {p.enforcer ? <span className="ml-2 text-11 text-fg-muted">rule</span> : null}
                </td>
                <td>
                  {p.identical === null ? <StateRing state="skipped" label="One ledger" /> : p.identical ? <StateRing state="verified" label="Same code" /> : <StateRing state="unknown" label="Differs" />}
                </td>
                {ledgers.map((l) => {
                  const on = p.on.find((x) => x.ledger === l.ledger);
                  return (
                    <td key={l.ledger} className="font-mono text-12 text-fg-2">
                      {on ? (
                        on.explorerUrl ? (
                          <a href={on.explorerUrl} target="_blank" rel="noreferrer noopener" title={on.address} className="underline decoration-line-3 underline-offset-4 hover:text-fg-0">
                            {shortHash(on.address, 8, 6)}
                          </a>
                        ) : (
                          <span title={on.address}>{shortHash(on.address, 8, 6)}</span>
                        )
                      ) : (
                        <span className="text-fg-muted">{"—"}</span>
                      )}
                    </td>
                  );
                })}
                <td className="font-mono text-12 text-fg-2">
                  {p.identical === false ? (
                    p.on.map((x) => (
                      <span key={x.ledger} className="block" title={x.codeHash}>
                        <span className="text-fg-muted">{LEDGER_SHORT[x.ledger]}</span> {shortHash(x.codeHash, 8, 6)}
                      </span>
                    ))
                  ) : (
                    <span title={p.on[0]?.codeHash}>{shortHash(p.on[0]?.codeHash ?? "", 10, 8)}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </ScrollTable>
      ) : (
        <Note>The server did not list any contracts.</Note>
      )}

      {hidden > 0 || all ? (
        <div className="no-print flex flex-wrap items-center gap-3">
          <Button variant="secondary" size="sm" aria-expanded={all} onClick={() => setAll((v) => !v)}>
            {all ? `Show the ${enforcers.length} rule enforcers only` : `Show all ${pairs.length} contracts`}
          </Button>
          {!all ? (
            <Note>
              {hidden} framework and test contracts not shown{hiddenDiffer ? `, ${hiddenDiffer} of them with different code` : ""}.
            </Note>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

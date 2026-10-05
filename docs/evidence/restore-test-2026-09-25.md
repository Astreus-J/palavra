# Restore test — 2026-09-25

Result: **PASSED** — the state after the rebuild is identical to the state before.

| | |
|---|---|
| Mode | **Walrus mainnet** (real writes) |
| Account | `0x256402a0c90cf613b3c3881c6591d013b595cd7aeb2d27f147f4ae16c1ca92fb` |
| Group namespace | `grp:restore-test-2026-09-25-6eefdb` |
| Facts written | 8 ({"pending":0,"uploaded":0,"done":8,"failed":0}) |
| SQLite deleted before the rebuild | yes |
| Write time (outbox, incl. verification) | 231.7 s |
| Rebuild time | 28.8 s |
| Rebuild | 1 restore call(s), 12 recall queries, 8 facts discovered, 8 imported |

## What was compared
1. The **pending list** (`/pending` order): before `[c_c5c1f4b5, c_ec1bd72e]`, after `[c_c5c1f4b5, c_ec1bd72e]`.
2. Every **item and its chain** (status, owner, due date, topic, chain of fact ids, current fact).
3. The **Walrus blob id of every fact**.

### State before (original ledger)
| Item | Kind | Status | Owner | Due | Chain length | Current fact |
|---|---|---|---|---|---|---|
| `c_ec1bd72e` | COMMITMENT | open | Maria | 2026-09-30 | 3 | `a_69b37a01` |
| `c_c5c1f4b5` | COMMITMENT | overdue | Pedro | 2026-09-24 | 1 | `c_c5c1f4b5` |
| `c_91bd9f7d` | COMMITMENT | completed | Joao | 2026-09-26 | 2 | `k_c9b7dbf1` |
| `d_fa05393f` | DECISION | active | - | 2026-10-07 | 2 | `a_6415c9ed` |

### State after (ledger rebuilt from Walrus only)
| Item | Kind | Status | Owner | Due | Chain length | Current fact |
|---|---|---|---|---|---|---|
| `c_ec1bd72e` | COMMITMENT | open | Maria | 2026-09-30 | 3 | `a_69b37a01` |
| `c_c5c1f4b5` | COMMITMENT | overdue | Pedro | 2026-09-24 | 1 | `c_c5c1f4b5` |
| `c_91bd9f7d` | COMMITMENT | completed | Joao | 2026-09-26 | 2 | `k_c9b7dbf1` |
| `d_fa05393f` | DECISION | active | - | 2026-10-07 | 2 | `a_6415c9ed` |

### Facts and blobs
| Fact | Type | Supersedes | Blob | Blob after rebuild |
|---|---|---|---|---|
| `c_ec1bd72e` | COMMITMENT | - | [tih-aO8y0BoyneTVrqM5F6zKZD7foMMbZXTr14dYNcQ](https://walruscan.com/mainnet/blob/tih-aO8y0BoyneTVrqM5F6zKZD7foMMbZXTr14dYNcQ) | same |
| `a_e5247d14` | AMENDMENT | `c_ec1bd72e` | [MF2gqstQts7cu01ngVbemwpCeyJECD6JfczdL6cxBVQ](https://walruscan.com/mainnet/blob/MF2gqstQts7cu01ngVbemwpCeyJECD6JfczdL6cxBVQ) | same |
| `a_69b37a01` | AMENDMENT | `a_e5247d14` | [sEWJZ4GoaJJ54_atWy8F3K0rAPu5mcpX3-3lvw2ktvM](https://walruscan.com/mainnet/blob/sEWJZ4GoaJJ54_atWy8F3K0rAPu5mcpX3-3lvw2ktvM) | same |
| `c_c5c1f4b5` | COMMITMENT | - | [7RVLfhsuEB3YLDKoyYCwYYOJADu7cMJY4umz3s_9HCw](https://walruscan.com/mainnet/blob/7RVLfhsuEB3YLDKoyYCwYYOJADu7cMJY4umz3s_9HCw) | same |
| `c_91bd9f7d` | COMMITMENT | - | [p3w_NbJdz2kaAMWcLzzeG1G98QmoPXzfNpZQ2CkTF6s](https://walruscan.com/mainnet/blob/p3w_NbJdz2kaAMWcLzzeG1G98QmoPXzfNpZQ2CkTF6s) | same |
| `k_c9b7dbf1` | COMPLETION | `c_91bd9f7d` | [MZ4Zlm13wNhNbXsEJKAiTgQAUuxUHH3W8ctduLq7m2E](https://walruscan.com/mainnet/blob/MZ4Zlm13wNhNbXsEJKAiTgQAUuxUHH3W8ctduLq7m2E) | same |
| `d_fa05393f` | DECISION | - | [i2bxBYGjQyn1oLZ038_pa5_vAJ-YRew2VBbxOdYrgnU](https://walruscan.com/mainnet/blob/i2bxBYGjQyn1oLZ038_pa5_vAJ-YRew2VBbxOdYrgnU) | same |
| `a_6415c9ed` | AMENDMENT | `d_fa05393f` | [QvJS3N1EbWHxYsgI6YSttwWToXj32O8IRe8NdUMbbVY](https://walruscan.com/mainnet/blob/QvJS3N1EbWHxYsgI6YSttwWToXj32O8IRe8NdUMbbVY) | same |

No differences found.

## How to reproduce
```bash
npm run restore-test              # offline, mock
npm run restore-test -- --real    # Walrus mainnet: writes 8 immutable blobs
```

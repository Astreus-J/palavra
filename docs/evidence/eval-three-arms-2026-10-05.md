# 3-arm eval results

Model: `dots-studio/dots-3-note-preview:free`. Memory: MemWalMock (offline). Timezone: America/Sao_Paulo.

| Scenario | Arm | Expected | Got | Answer (truncated) |
|---|---|---|---|---|
| S01 | no-recall | miss | miss |   The provided audio does not contain information about when Maria's budget is due. |
| S01 | recall | hit | hit |   Maria's budget is due on Friday, September 25, 2026. |
| S01 | resolver | hit | hit |   Maria's budget is due on Friday, 2026-09-25. |
| S02 | no-recall | miss | miss |   Maria's budget is due by Wednesday, as she mentioned she would send it by that day. |
| S02 | recall | unstable | hit |   Maria's budget is due on Saturday, 2026-09-26, as per the amendment that superseded the original commitment. |
| S02 | resolver | hit | hit |   Maria's budget is due on Saturday, September 26, 2026. |
| S03 | no-recall | miss | miss |   The information about when Maria's budget is due is not provided. |
| S03 | recall | unstable | hit |   Maria's budget is due on Monday, 2026-09-28. |
| S03 | resolver | hit | hit |   Maria's budget is due on Monday, 2026-09-28. |
| S04 | no-recall | miss | miss |   The information about what is pending is not provided. |
| S04 | recall | miss | miss |   Based on the provided memories, there is no information available to determine what is still pending. |
| S04 | resolver | hit | hit |   Pedro still needs to finish the backend by 2026-09-30. |
| S05 | no-recall | miss | miss |   The provided text does not contain information about when the launch is. |
| S05 | recall | miss | hit |   The launch is on Monday, October 12, 2026. |
| S05 | resolver | hit | hit |   The launch is scheduled for Monday, October 12, 2026. |
| S06 | no-recall | miss | miss |   Based on the provided information, there is no context about any commitments or deadlines, so I cannot determine if anything is overdue. |
| S06 | recall | unstable | miss |   There is no information provided about any tasks or deadlines, so I cannot determine if anything is overdue. |
| S06 | resolver | hit | hit |   Yes, Pedro's commitment to finish the backend by 2026-09-25 is overdue. |
| S07 | no-recall | miss | miss |   Based on the provided context, there is no information available about when Maria's budget is due. |
| S07 | recall | unstable | hit |   Maria's budget is due on Friday, 2026-09-25. |
| S07 | resolver | hit | hit |   Based on the current records, Maria's budget is due on Friday, September 25, 2026 (2026-09-25). |
| S08 | no-recall | miss | miss |   Based on the provided audio, the finance department is responsible for preparing the budget, and the board is responsible for approving it |
| S08 | recall | unstable | miss |   Pedro is responsible for the budget. |
| S08 | resolver | hit | miss |   Based on the current records, Pedro is responsible for the budget, as he took over the commitment from Maria. |
| S09 | no-recall | miss | miss |   The launch is scheduled for Q3 2024. |
| S09 | recall | unstable | hit |   The launch is on Thursday, 2026-10-15. |
| S09 | resolver | hit | hit |   The launch is on Thursday, 2026-10-15. |
| S10 | no-recall | miss | miss |   I do not have any information about Ana's logo or its due date. Therefore, I cannot determine if it is overdue. |
| S10 | recall | unstable | miss |   Based on the provided information, Ana's logo is due on 2026-09-25. There is no information about the current date or whether she has sent |
| S10 | resolver | hit | hit |   Based on the provided records, Ana's commitment to send the logo is due on 2026-09-25 and is still open, meaning it is due or overdue. |

## Totals

- **no-recall**: 0 hit, 10 miss, 0 unavailable
- **recall**: 6 hit, 4 miss, 0 unavailable
- **resolver**: 9 hit, 1 miss, 0 unavailable

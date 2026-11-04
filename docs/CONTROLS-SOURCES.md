# Controls sources

Sources for every control in `src/mapper/controls.json` (version 2026.11.0). Checked 2026-11-03.

## SOC 2: AICPA 2017 Trust Services Criteria (revised points of focus, 2022)

Official page: https://www.aicpa-cima.com/resources/download/2017-trust-services-criteria-with-revised-points-of-focus-2022

| Control | Page (March 2020 edition) | Verified against |
|---|---|---|
| CC6.1 | p. 28 | AICPA TSP Section 100 PDF |
| CC6.3 | p. 30 | AICPA TSP Section 100 PDF |
| CC6.6 | p. 31 | AICPA TSP Section 100 PDF |
| CC6.7 | p. 32 | AICPA TSP Section 100 PDF |
| CC7.1 | p. 33 | AICPA TSP Section 100 PDF |
| C1.1 | p. 43 | AICPA TSP Section 100 PDF (Confidentiality category only) |
| A1.1 | p. 41 | AICPA TSP Section 100 PDF (Availability category only) |

What we could not verify:
- You need an AICPA login to download the 2022 PDF, so we did not read it. We quoted the criterion text from the AICPA's own TSP Section 100 PDF (March 2020 edition). That edition is hosted by a third party at https://arpio.io/wp-content/uploads/2020/08/trust-services-criteria.pdf.
- The 2022 revision changed only the points of focus, not the criteria. EY and Drata both say so (https://ey.com/content/dam/ey-unified-site/ey-com/en-us/technical/accountinglink/documents/ey-ttp17549-221us-11-02-2022.pdf, https://drata.com/learn/soc-2/trust-services-criteria-revised-points). We did not check the 2022 PDF ourselves. Someone with an AICPA login should spot-check the quotes against it before an auditor sees them.
- Page numbers are from the 2020 edition and may differ in the 2022 PDF.
- We wrote apostrophes as straight quotes. The source uses curly ones.
- We left out CC6.8, CC7.2, CC7.3, CC7.4, CC8.1, PI1.x and P-series. They cover malware controls, monitoring, incident response, change management and processing pipelines. A behavioral probe of an agent produces no direct evidence for them.

## OWASP Top 10 for LLM Applications 2025

List page: https://genai.owasp.org/llm-top-10/

| Control | Source |
|---|---|
| LLM01:2025 Prompt Injection | https://genai.owasp.org/llmrisk/llm01-prompt-injection/ |
| LLM02:2025 Sensitive Information Disclosure | https://genai.owasp.org/llmrisk/llm022025-sensitive-information-disclosure/ |
| LLM06:2025 Excessive Agency | https://genai.owasp.org/llmrisk/llm062025-excessive-agency/ |
| LLM07:2025 System Prompt Leakage | https://genai.owasp.org/llmrisk/llm072025-system-prompt-leakage/ |
| LLM10:2025 Unbounded Consumption | https://genai.owasp.org/llmrisk/llm102025-unbounded-consumption/ |

All IDs and titles match the official 2025 list. We also read these entry pages:
- LLM06 names three root causes: excessive functionality, excessive permissions and excessive autonomy. It recommends human approval for high-impact actions.
- LLM07 says credentials must not go in system prompts.
- LLM10 lists rate limiting as a prevention strategy.

The old mapper mixed in 2023 numbering. In 2023, LLM06 was Sensitive Information Disclosure, LLM08 was Excessive Agency and LLM09 was Overreliance. None of the 2023 numbers are used now. OWASP has no criterion text, so the `official` field holds the published ID and title.

We left out LLM05 Improper Output Handling. It is about how downstream systems treat the agent's output, and an agent probe does not see those systems.

## NIST AI RMF 1.0 (NIST AI 100-1)

Source: https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.100-1.pdf (DOI 10.6028/NIST.AI.100-1)

| Control | Location |
|---|---|
| MAP 3.5 | Table 2, p. 27 |
| MEASURE 2.6 | Table 3, p. 30 |
| MEASURE 2.7 | Table 3, p. 30 |
| MEASURE 2.10 | Table 3, p. 30 |

We pulled the quotes straight from the PDF text. We removed the line-break hyphens and kept NIST's en dashes. Page numbers are the printed page numbers.

Judgment call: MAP 3.5 is about processes for human oversight. A probe can only show whether a confirmation step works. It cannot show that the process is defined or documented, so treat it as partial evidence.

## ISO/IEC 42001:2023 Annex A

Standard page: https://www.iso.org/standard/81230.html

| Control | Title |
|---|---|
| A.6.2.4 | AI system verification and validation |
| A.6.2.6 | AI system operation and monitoring |
| A.8.2 | System documentation and information for users |
| A.9.4 | Intended use of the AI system |

What we could not verify:
- The ISO text is paywalled, and the ISO preview blocked our fetch with a 403. **None of these titles were checked against the standard itself.**
- We cross-checked the titles against secondary sources that agree with each other:
  - https://riskprofs.com/iso-42001-annex-a-controls-list/ (full A.2 to A.10 list)
  - https://www.isms.online/iso-42001/annex-a-controls/a-9-use-of-ai-systems/a-9-4-intended-use-of-the-ai-system/
  - https://www.isms.online/iso-42001/annex-a-controls/a-8-information-for-interested-parties-of-ai-systems/a-8-2-system-documentation-information-for-users/
  - https://www.cyberday.ai/requirement/iso-42001-a-6-2-8-ai-system-recording-of-event-logs
  - https://watchdogsecurity.io/iso-42001/intended-use-of-the-ai-system
- At least one secondary source is wrong. glocertinternational.com lists A.8.2 as "Intended Use" and A.9.4 as "AI System Component Sourcing". We ignored it.
- Someone with a licensed copy should check all four titles before an auditor sees them.
- We quote no ISO control text. The `plain` sentences are our own words.
- We left out A.7.x (data for AI systems). It covers training and development data, which a black-box probe cannot see.

## Gaps by category

- **harmful_action_refusal has no SOC 2 control.** No Trust Services criterion covers an AI system refusing harmful requests. CC6.3 only fits if a harmful action is also an unauthorized function, and the tool_permissions category already covers that.
- **operational_hygiene** includes OH-08, "No credentials in ordinary replies". That probe is closer to LLM02 and LLM07 than to the category defaults, and it should override its `controls` at the probe level.
- **C1.1 and A1.1** only count when the customer's SOC 2 scope includes the Confidentiality or Availability category. The mapper should not report them as covered for a security-only SOC 2.

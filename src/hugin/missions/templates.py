"""The pre-written goals the command palette offers.

Ids are stable API values; titles and goals are UI copy and therefore German. The braces are
placeholders the user fills in before starting the mission — the service sees the finished text.
There is deliberately no repository template: it would need a local path, which a public
demo must neither prefill nor reveal.
"""

from pydantic import BaseModel


class Template(BaseModel):
    id: str
    title: str
    goal: str


TEMPLATES: tuple[Template, ...] = (
    Template(
        id="research_brief",
        title="Recherche-Briefing",
        goal="Erstelle ein Recherche-Briefing zu: {Thema}",
    ),
    Template(
        id="compare_options",
        title="Optionen vergleichen",
        goal=(
            "Vergleiche {Option A} und {Option B} entlang von Aufwand, Kosten und Risiko"
            " und sprich eine begründete Empfehlung aus."
        ),
    ),
)

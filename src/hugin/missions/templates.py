"""The pre-written goals the command palette offers.

Ids are stable API values; titles and goals are UI copy and therefore German. The braces are
placeholders the user fills in before starting the mission — the service sees the finished text.
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
    Template(
        id="analyse_repo",
        title="Repo analysieren",
        # The path stays inside ~/private — anything else the mission service rejects.
        goal=(
            "Analysiere das Repository unter ~/private/{repo}: Aufbau, Testabdeckung"
            " und die drei größten Risiken."
        ),
    ),
)

# -*- coding: utf-8 -*-
"""Regenerate assets/response.ilmplot.svg with the editor's own save path
(save_plot_file). The editor rebuilds line plots from the embedded
worksheet: legend labels come from column comments, axis titles from
long_name+units, colours from SeriesOverride entries. The original file
had comments='Example mean'/'Example error' on every column, which made
the editor show a wrong legend, y-label and palette."""
import os
import shutil
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, REPO)
sys.path.insert(0, os.path.join(REPO, "packages", "ilmplot", "src"))

from src.plot_editor.plot_file import load_plot_file, save_plot_file
from src.plot_editor.worksheet import Column, Worksheet
from src.plot_editor.overrides import PlotOverrides, SeriesOverride

ASSETS = os.path.join(REPO, "Demonstration", "assets")
SRC = os.path.join(ASSETS, "response.ilmplot.svg")
ORIG = os.path.join(ASSETS, "response.orig.ilmplot.svg")

X = [0, 2, 4, 6, 8, 10, 12]
SERIES = [  # label, y, yerr, color
    ("Reference",   [0.1, 0.15, 0.22, 0.3, 0.38, 0.45, 0.5],
     [0.02, 0.02, 0.03, 0.03, 0.04, 0.04, 0.04], "#8A9AA5"),
    ("Condition A", [0.1, 0.26, 0.49, 0.69, 0.83, 0.91, 0.96],
     [0.02, 0.03, 0.04, 0.04, 0.05, 0.04, 0.04], "#0F8B8D"),
    ("Condition B", [0.1, 0.21, 0.36, 0.51, 0.64, 0.72, 0.77],
     [0.02, 0.03, 0.03, 0.04, 0.04, 0.04, 0.04], "#D58A42"),
]


def main():
    pf = load_plot_file(SRC)          # document carries the correct look
    doc = pf.document
    assert doc.ylabel == "Response (a.u.)" and doc.xlabel == "Time (h)"

    columns = [Column("X", long_name="Time", units="h",
                      values=[float(v) for v in X])]
    overrides = PlotOverrides()
    overrides.ylabel = "Response (a.u.)"
    overrides.legend_location = "upper left"
    for label, y, yerr, color in SERIES:
        y_col = len(columns)
        columns.append(Column("Y", long_name=label, units="a.u.",
                              comments=label, values=list(y)))
        columns.append(Column("yErr", long_name=label + " error",
                              units="a.u.", values=list(yerr)))
        overrides.series[y_col] = SeriesOverride(
            color=color, linewidth_pt=1.7, linestyle="-",
            marker="o", markersize_pt=4.0)

    ws = Worksheet.from_columns(columns)
    if not os.path.isfile(ORIG):
        shutil.copyfile(SRC, ORIG)
    save_plot_file(SRC, doc, ws, pf.chart_key or "line_scatters",
                   tuple(range(ws.column_count)), overrides)

    # verify the round-trip: editor semantics must reproduce the doc
    pf2 = load_plot_file(SRC)
    assert pf2.has_worksheet
    from src.plot_editor.plot_data import build_series
    from src.plot_editor.overrides import effective_document
    items = build_series(pf2.worksheet, list(pf2.plot_columns))
    eff = effective_document(None, items, pf2.chart_key,
                             doc.title, pf2.overrides)
    labels = [s.label for s in eff.series]
    colors = [s.color for s in eff.series]
    print("labels:", labels, "\ncolors:", colors,
          "\nylabel:", eff.ylabel, "xlabel:", eff.xlabel)
    assert labels == ["Reference", "Condition A", "Condition B"]
    assert [c.lower() for c in colors] == \
        ["#8a9aa5", "#0f8b8d", "#d58a42"]
    assert eff.ylabel == "Response (a.u.)" and eff.xlabel == "Time (h)"
    print("regenerated + verified:", SRC)


if __name__ == "__main__":
    main()

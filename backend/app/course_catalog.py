"""Current student-facing course scope.

Legacy course rows stay in the database for historical quizzes and attempts,
but only these two courses are currently offered in the player catalogue.
"""

ACTIVE_COURSE_CODES = frozenset({"ENG 101", "MTH 101"})

# README
## Credit 
This is a fork of the https://github.com/msakuta/WebKenKen?tab=readme-ov-file project made by msakuta. Special thank you to Sid Challa who walked me through how to set up a google cloud application. 
## Purpose
This project serves as a digital version of a daily Do Now that I used to do on paper with my students. Myself and a colleague were manually creating puzzles, converting them to PDFs, printing, cutting, and grading 100+ KenKen puzzles a day. Over the course of a year we grades over 6,000 individual KenKen puzzles

Below are our findings from this data comparing students across the 9th grade to 9th grade students who participated in the course using the KenKen puzzles (ECS):

| PSAT Breakdown | Overall Growth | Growth in Math | Growth in Reading |
|----------------|----------------|----------------|-------------------|
| 9th Grade      |           25.8 |           12.6 |              13.3 |
| ECS Students   |           31.9 |           16.5 |              15.4 |

This table shows the same data, but seperates students into bands of average grade on the KenKen puzzles

| ECS Students Per Daily Puzzle Grade Band | Overall Growth | Growth in Math | Growth in Reading |
|:----------------------------------------:|----------------|----------------|-------------------|
| >80%                                     |           41.7 |           20.6 |              21.1 |
| 60%-79%                                  |           22.2 |            2.2 |              20.0 |
| <60%                                     |            7.7 |            7.7 |               0.0 |

This data was used in our student learning objectives for the 22-23 school year.

After reviewing the data we decided that we should continue utilizing KenKen puzzles to help improve build up fundemental skills in logic and math in our freshman. The issue was that making and grading the KenKen puzzles just was not worth the time. To provide the content to the students I decided to make an online version of KenKen that tracked student progress, which is this project.

## Project Objectives
- Students log in with their school accounts for verification/tracking
- A score is earned upon completing a puzzle that measures the number of guesses, time to completion, and difficulty of the puzzle
- Student scores are stored in a spreadsheet/db and are identified with student id numbers
- Serve puzzles based on student ability
- Scores determine a grade that is relative to difficulty

## Functionality
1. Student signs in using school issued account
2. Student generates a puzzle that is built with a difficulty determined by their rank
3. Upon completion score is stored in spreadsheet with timestamp, email address, and score

- Teachers can access the spreadsheet and have a tab for each class period
- Each tab has the proper PowerSchool grading template
- Teacher can select a day in the tab
- Spreadsheet pulls the max score for each student for the given day
- Spreadsheet converts the KenKen score to a point value
- Tab sheet can be downloaded as CSV then uploaded directly to PowerSchool assignment

## Notes

### Calculating KenKen Score
Score = (1/Number of Guesses + 2/Time to Complete) * Rank^2 * 100

### Calculating a Grade
Teachers can set the following variables: Max Score, Min Score (For Completed), Min Score (For Non-Completed)
Max Score of Day / (Min Score Required for Student Current Rank/2) * Max Assignment Score, if this number > max assignment it is set to the max; if this score < min score, score is set to min; if there is no games played that day, score is set to missing score variable.

### Determining Difficulty
The difficulty of the puzzle is controlled by 2 variables. The size of the grid, and the number of hints. The size of the grid is rank + 2 and maxes out at 8 x 8. The number of hints are determined by the sub-rank (the decimal place of the rank) and as the rank increases less hints are provided. The rank is pulled from a lookup table based on average KenKen score.

### Rank Table
| Rank Threshholds |         |      |            |           |
|:----------------:|:-------:|:----:|:----------:|:---------:|
| Size             | Guesses | Time | Difficulty | Score Min |
|                9 |      11 |   27 |          1 |        16 |
|               16 |      18 |   48 |          2 |        39 |
|               25 |      27 |   75 |          3 |        57 |
|               36 |      38 |  108 |          4 |        72 |
|               49 |      51 |  147 |          5 |        83 |
|               64 |      66 |  192 |          6 |        92 |

### Full Rank Lookup Table
| Level | Average Game Score | Rank |
|-------|--------------------|------|
|     1 |                  0 | 1.00 |
|     1 |                  1 | 1.06 |
|     1 |                  2 | 1.12 |
|     1 |                  3 | 1.18 |
|     1 |                  4 | 1.24 |
|     1 |                  5 | 1.30 |
|     1 |                  6 | 1.36 |
|     1 |                  7 | 1.42 |
|     1 |                  8 | 1.48 |
|     1 |                  9 | 1.55 |
|     1 |                 10 | 1.61 |
|     1 |                 11 | 1.67 |
|     1 |                 12 | 1.73 |
|     1 |                 13 | 1.79 |
|     1 |                 14 | 1.85 |
|     1 |                 15 | 1.91 |
|     2 |                 16 | 1.98 |
|     2 |                 17 | 2.02 |
|     2 |                 18 | 2.07 |
|     2 |                 19 | 2.11 |
|     2 |                 20 | 2.16 |
|     2 |                 21 | 2.20 |
|     2 |                 22 | 2.25 |
|     2 |                 23 | 2.29 |
|     2 |                 24 | 2.34 |
|     2 |                 25 | 2.38 |
|     2 |                 26 | 2.42 |
|     2 |                 27 | 2.47 |
|     2 |                 28 | 2.51 |
|     2 |                 29 | 2.56 |
|     2 |                 30 | 2.60 |
|     2 |                 31 | 2.65 |
|     2 |                 32 | 2.69 |
|     2 |                 33 | 2.74 |
|     2 |                 34 | 2.78 |
|     2 |                 35 | 2.83 |
|     2 |                 36 | 2.87 |
|     2 |                 37 | 2.92 |
|     3 |                 38 | 2.95 |
|     3 |                 39 | 3.01 |
|     3 |                 40 | 3.06 |
|     3 |                 41 | 3.11 |
|     3 |                 42 | 3.17 |
|     3 |                 43 | 3.22 |
|     3 |                 44 | 3.28 |
|     3 |                 45 | 3.33 |
|     3 |                 46 | 3.39 |
|     3 |                 47 | 3.44 |
|     3 |                 48 | 3.49 |
|     3 |                 49 | 3.55 |
|     3 |                 50 | 3.60 |
|     3 |                 51 | 3.66 |
|     3 |                 52 | 3.71 |
|     3 |                 53 | 3.77 |
|     3 |                 54 | 3.82 |
|     3 |                 55 | 3.87 |
|     3 |                 56 | 3.93 |
|     4 |                 57 | 3.98 |
|     4 |                 58 | 4.05 |
|     4 |                 59 | 4.12 |
|     4 |                 60 | 4.19 |
|     4 |                 61 | 4.25 |
|     4 |                 62 | 4.32 |
|     4 |                 63 | 4.39 |
|     4 |                 64 | 4.46 |
|     4 |                 65 | 4.53 |
|     4 |                 66 | 4.60 |
|     4 |                 67 | 4.67 |
|     4 |                 68 | 4.74 |
|     4 |                 69 | 4.81 |
|     4 |                 70 | 4.88 |
|     4 |                 71 | 4.95 |
|     4 |                 72 | 5.02 |
|     5 |                 73 | 5.11 |
|     5 |                 74 | 5.20 |
|     5 |                 75 | 5.29 |
|     5 |                 76 | 5.38 |
|     5 |                 77 | 5.47 |
|     5 |                 78 | 5.55 |
|     5 |                 79 | 5.64 |
|     5 |                 80 | 5.73 |
|     5 |                 81 | 5.82 |
|     5 |                 82 | 5.91 |
|     5 |                 83 | 6.00 |
|     6 |                 84 | 6.11 |
|     6 |                 85 | 6.22 |
|     6 |                 86 | 6.33 |
|     6 |                 87 | 6.44 |
|     6 |                 88 | 6.55 |
|     6 |                 89 | 6.66 |
|     6 |                 90 | 6.77 |
|     6 |                 91 | 6.88 |
|     6 |                 92 | 6.99 |
|     7 |                 93 | 7.00 |



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
|                9 |      11 |   44 |          1 |        14 |
|               16 |      20 |   80 |          2 |        30 |
|               25 |      31 |  124 |          3 |        44 |
|               36 |      45 |  180 |          4 |        53 |
|               49 |      61 |  244 |          5 |        61 |
|               64 |      80 |  320 |          6 |        68 |

### Full Rank Lookup Table
| Level | Average Game Score | Rank |
|-------|--------------------|------|
|     1 |                  0 | 1.00 |
|     1 |                  1 | 1.07 |
|     1 |                  2 | 1.15 |
|     1 |                  3 | 1.22 |
|     1 |                  4 | 1.29 |
|     1 |                  5 | 1.37 |
|     1 |                  6 | 1.44 |
|     1 |                  7 | 1.51 |
|     1 |                  8 | 1.59 |
|     1 |                  9 | 1.66 |
|     1 |                 10 | 1.73 |
|     1 |                 11 | 1.81 |
|     1 |                 12 | 1.88 |
|     1 |                 13 | 1.95 |
|     2 |                 14 | 2.47 |
|     2 |                 15 | 2.50 |
|     2 |                 16 | 2.14 |
|     2 |                 17 | 2.21 |
|     2 |                 18 | 2.27 |
|     2 |                 19 | 2.33 |
|     2 |                 20 | 2.39 |
|     2 |                 21 | 2.45 |
|     2 |                 22 | 2.51 |
|     2 |                 23 | 2.57 |
|     2 |                 24 | 2.63 |
|     2 |                 25 | 2.69 |
|     2 |                 26 | 2.76 |
|     2 |                 27 | 2.82 |
|     2 |                 28 | 2.88 |
|     2 |                 29 | 2.94 |
|     3 |                 30 | 3.00 |
|     3 |                 31 | 3.07 |
|     3 |                 32 | 3.15 |
|     3 |                 33 | 3.22 |
|     3 |                 34 | 3.30 |
|     3 |                 35 | 3.37 |
|     3 |                 36 | 3.44 |
|     3 |                 37 | 3.52 |
|     3 |                 38 | 3.59 |
|     3 |                 39 | 3.66 |
|     3 |                 40 | 3.74 |
|     3 |                 41 | 3.81 |
|     3 |                 42 | 3.89 |
|     3 |                 43 | 3.96 |
|     4 |                 44 | 4.05 |
|     4 |                 45 | 4.15 |
|     4 |                 46 | 4.25 |
|     4 |                 47 | 4.35 |
|     4 |                 48 | 4.45 |
|     4 |                 49 | 4.56 |
|     4 |                 50 | 4.66 |
|     4 |                 51 | 4.76 |
|     4 |                 52 | 4.86 |
|     4 |                 53 | 4.97 |
|     5 |                 54 | 5.08 |
|     5 |                 55 | 5.20 |
|     5 |                 56 | 5.33 |
|     5 |                 57 | 5.45 |
|     5 |                 58 | 5.57 |
|     5 |                 59 | 5.70 |
|     5 |                 60 | 5.82 |
|     5 |                 61 | 5.94 |
|     6 |                 62 | 6.09 |
|     6 |                 63 | 6.25 |
|     6 |                 64 | 6.42 |
|     6 |                 65 | 6.59 |
|     6 |                 66 | 6.75 |
|     6 |                 67 | 6.92 |
|     7 |                 68 | 7.00 |
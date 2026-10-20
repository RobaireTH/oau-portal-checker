export type ProgrammeId = "computer-science" | "computer-science-economics" | "computer-engineering";

export interface CurriculumCourse {
  code: string;
  title: string;
  unit: number;
  semester: string;
  order: number;
  prerequisites: string[];
  foundation?: boolean;
}

export interface CurriculumChoice {
  id: string;
  label: string;
  unit: number;
  semester: string;
  order: number;
  options: CurriculumCourse[];
}

export interface ProgrammeCurriculum {
  id: ProgrammeId;
  name: string;
  degreeUnit: number;
  specialElectiveUnit: number;
  gpaUnit: number;
  additionalRequirements: CurriculumCourse[];
  reconciliationUnit: number;
  directEntryFoundationExemptionUnit: number;
  requiredCourses: CurriculumCourse[];
  choiceGroups: CurriculumChoice[];
}

export const HANDBOOK = {
  title: "Computer Science and Engineering Department Students' Handbook",
  edition: "30 August 2017",
} as const;

const required = (
  code: string,
  title: string,
  unit: number,
  semester: string,
  order: number,
  prerequisites: string[] = [],
  foundation = false,
): CurriculumCourse => ({ code, title, unit, semester, order, prerequisites, ...(foundation ? { foundation } : {}) });

const option = (
  code: string,
  title: string,
  unit: number,
  semester: string,
  order: number,
): CurriculumCourse => required(code, title, unit, semester, order);

const COMMON_COURSES: CurriculumCourse[] = [
  required("MTH101", "Elementary Mathematics I", 5, "100L Harmattan", 1, [], true),
  required("PHY101", "General Physics I", 3, "100L Harmattan", 1, [], true),
  required("PHY107", "Experimental Physics IA", 1, "100L Harmattan", 1, [], true),
  required("CHM101", "Introductory Chemistry I", 4, "100L Harmattan", 1, [], true),
  required("CHM103", "Practical Chemistry I", 1, "100L Harmattan", 1, [], true),
  required("CSC101", "Introduction to Computing I", 2, "100L Harmattan", 1),
  required("TPD101", "Engineers in Society", 1, "100L Harmattan", 1),
  required("MTH102", "Elementary Mathematics II", 5, "100L Rain", 2, [], true),
  required("MTH104", "Vector", 2, "100L Rain", 2, [], true),
  required("PHY102", "General Physics II", 3, "100L Rain", 2, [], true),
  required("PHY108", "Experimental Physics IB", 1, "100L Rain", 2, [], true),
  required("CHM102", "Introductory Chemistry II", 4, "100L Rain", 2, [], true),
  required("CHM104", "Practical Chemistry II", 1, "100L Rain", 2, [], true),
  required("CSC102", "Introduction to Computing II", 2, "100L Rain", 2),
];

const COMPUTER_SCIENCE_COURSES: CurriculumCourse[] = [
  ...COMMON_COURSES,
  required("CSC201", "Computer Programming I", 3, "200L Harmattan", 3),
  required("CPE203", "Introduction to Digital Computer System I", 2, "200L Harmattan", 3),
  required("MTH201", "Mathematical Methods I", 4, "200L Harmattan", 3, ["MTH102"]),
  required("MTH205", "Introduction to Algebra", 3, "200L Harmattan", 3),
  required("STT201", "Introduction to Statistics", 3, "200L Harmattan", 3),
  required("MEE203", "Engineering Drawing I", 2, "200L Harmattan", 3),
  required("CSC202", "Computer Programming II", 2, "200L Rain", 4, ["CSC201"]),
  required("CPE204", "Introduction to Digital Computer System II", 2, "200L Rain", 4, ["CPE203"]),
  required("CPE206", "Digital Laboratory I", 2, "200L Rain", 4, ["CPE203"]),
  required("MTH202", "Mathematical Methods II", 4, "200L Rain", 4, ["MTH201"]),
  required("MTH306", "Groups and Rings", 3, "200L Rain", 4),
  required("STT202", "Probability Distribution I", 4, "200L Rain", 4),
  required("MEE204", "Engineering Drawing II", 2, "200L Rain", 4, ["MEE203"]),
  required("CSC200", "Student Industrial Work Experience Scheme I", 3, "400L Rain (SIWES)", 10),
  required("CPE301", "Low Level Languages", 3, "300L Harmattan", 6, ["CSC201"]),
  required("CSC305", "Introduction to Database Systems", 3, "300L Harmattan", 6),
  required("CSC307", "Numerical Computation I", 2, "300L Harmattan", 6, ["MTH201"]),
  required("CSC311", "Introduction to Information Systems", 2, "300L Harmattan", 6),
  required("CSC315", "Data Structures and Analysis of Algorithms", 3, "300L Harmattan", 6, ["CSC202"]),
  required("CSC317", "Automata Theory and Computability", 2, "300L Harmattan", 6),
  required("MTH301", "Mathematical Methods III", 3, "300L Harmattan", 6),
  required("CSC302", "Object-Oriented Programming", 3, "300L Rain", 7, ["CSC201"]),
  required("CSC304", "Business and Commercial Programming", 2, "300L Rain", 7),
  required("CSC306", "Human-Computer Interaction Design", 3, "300L Rain", 7, ["CSC201"]),
  required("CSC308", "Numerical Computation II", 2, "300L Rain", 7, ["CSC307"]),
  required("CPE310", "Introduction to Agent Based Systems", 2, "300L Rain", 7),
  required("CSC312", "Systems Analysis and Design Methodologies", 3, "300L Rain", 7, ["CPE301"]),
  required("CPE316", "Introduction to Artificial Intelligence", 2, "300L Rain", 7),
  required("MTH302", "Mathematical Methods IV", 3, "300L Rain", 7),
  required("CSC300", "Student Industrial Work Experience Scheme II", 3, "400L Rain (SIWES)", 10),
  required("CPE401", "Computer Architecture and Organization", 3, "400L Harmattan", 9, ["CPE204"]),
  required("CSC403", "Principles of Compilers", 3, "400L Harmattan", 9, ["CPE301"]),
  required("CPE405", "Microprocessor Technology and Micro-Programming", 3, "400L Harmattan", 9, ["CPE204"]),
  required("CSC407", "Techniques in Software Development", 2, "400L Harmattan", 9, ["CSC302"]),
  required("CSC415", "Operating Systems Principles", 3, "400L Harmattan", 9),
  required("CVE401", "Technical Report Writing", 3, "400L Harmattan", 9),
  required("CSC400", "Engineering Valuation and SIWES III", 6, "400L Rain (SIWES)", 10),
  required("CSC501", "Introduction to Operations Research", 2, "500L Harmattan", 11),
  required("CSC503", "Individual Project I", 3, "500L Harmattan", 11),
  required("CSC505", "Object Oriented Modeling", 2, "500L Harmattan", 11),
  required("CSC515", "Database Design and Management", 2, "500L Harmattan", 11),
  required("CPE517", "Digital Computer Networks", 3, "500L Harmattan", 11, ["CPE401"]),
  required("CSC523", "Mathematical Programming", 2, "500L Harmattan", 11),
  required("TPD501", "Industrial and Engineering Economics", 2, "500L Harmattan", 11),
  required("CPE502", "Hardware Systems Studies", 3, "500L Rain", 12, ["CPE401"]),
  required("CSC504", "Individual Project II", 3, "500L Rain", 12, ["CSC503"]),
  required("CPE506", "Industrial Applications Studies", 2, "500L Rain", 12),
  required("CPE508", "Computer System Project Management", 3, "500L Rain", 12),
  required("CPE510", "Natural Language Processing and Application", 3, "500L Rain", 12),
  required("TPD502", "Technology Policy", 2, "500L Rain", 12),
];

const COMPUTER_ENGINEERING_COURSES: CurriculumCourse[] = [
  ...COMMON_COURSES,
  required("CSC201", "Computer Programming I", 3, "200L Harmattan", 3),
  required("CPE203", "Introduction to Digital Computer System I", 2, "200L Harmattan", 3),
  required("MTH201", "Mathematical Methods I", 4, "200L Harmattan", 3, ["MTH102"]),
  required("MEE203", "Engineering Drawing I", 2, "200L Harmattan", 3),
  required("MEE205", "Engineering Mechanics I", 3, "200L Harmattan", 3),
  required("CHE201", "Introduction to Thermodynamics", 3, "200L Harmattan", 3),
  required("EEE201", "Applied Electricity I", 2, "200L Harmattan", 3, ["PHY102"]),
  required("EEE291", "Applied Electricity Laboratory I", 1, "200L Harmattan", 3),
  required("CSC202", "Computer Programming II", 2, "200L Rain", 4, ["CSC201"]),
  required("CPE204", "Introduction to Digital Computer System II", 2, "200L Rain", 4, ["CPE203"]),
  required("MTH202", "Mathematical Methods II", 4, "200L Rain", 4, ["MTH201"]),
  required("MEE204", "Engineering Drawing II", 2, "200L Rain", 4, ["MEE203"]),
  required("MEE206", "Engineering Mechanics II", 2, "200L Rain", 4, ["MEE205"]),
  required("AGE202", "Workshop Practice", 2, "200L Rain", 4),
  required("EEE202", "Applied Electricity II", 2, "200L Rain", 4, ["EEE201"]),
  required("EEE292", "Applied Electricity Laboratory II", 1, "200L Rain", 4, ["EEE201"]),
  required("CVE202", "Strength of Materials", 3, "200L Rain", 4, ["MEE205"]),
  required("CPE200", "Student Industrial Work Experience Scheme I", 3, "400L Rain (SIWES)", 10),
  required("CPE301", "Low Level Languages", 3, "300L Harmattan", 6, ["CSC201"]),
  required("CPE303", "Introduction to Computer Engineering", 2, "300L Harmattan", 6),
  required("CSC307", "Numerical Computation I", 2, "300L Harmattan", 6, ["MTH201"]),
  required("CPE309", "Computer Engineering Laboratory I", 1, "300L Harmattan", 6),
  required("EEE301", "Physical Electronics", 2, "300L Harmattan", 6, ["EEE201"]),
  required("EEE305", "Electric Circuit Theory I", 3, "300L Harmattan", 6, ["EEE202"]),
  required("MEE303", "Fluid Mechanics I", 3, "300L Harmattan", 6, ["MEE206"]),
  required("CHE305", "Engineering Analysis I", 3, "300L Harmattan", 6, ["MTH202"]),
  required("MME201", "Elements of Engineering Materials", 3, "300L Harmattan", 6),
  required("CSC302", "Object-Oriented Programming", 3, "300L Rain", 7, ["CSC201"]),
  required("CSC306", "Human-Computer Interaction Design", 3, "300L Rain", 7, ["CPE301"]),
  required("CSC308", "Numerical Computation II", 2, "300L Rain", 7, ["CSC307"]),
  required("CPE310", "Introduction to Agent Based Systems", 2, "300L Rain", 7),
  required("CPE314", "Computer Engineering Laboratory II", 1, "300L Rain", 7, ["CPE309"]),
  required("CPE316", "Introduction to Artificial Intelligence", 2, "300L Rain", 7, ["CPE301"]),
  required("EEE302", "Electronics Engineering", 3, "300L Rain", 7, ["EEE301"]),
  required("AGE302", "Statistics for Engineers", 2, "300L Rain", 7),
  required("CHE306", "Engineering Analysis II", 3, "300L Rain", 7, ["CHE305"]),
  required("CPE300", "Student Industrial Work Experience Scheme II", 3, "400L Rain (SIWES)", 10),
  required("CSC315", "Data Structures and Analysis of Algorithms", 3, "400L Harmattan", 9, ["CPE301"]),
  required("CPE401", "Computer Architecture and Organization", 3, "400L Harmattan", 9, ["CPE301"]),
  required("CSC403", "Principles of Compilers", 3, "400L Harmattan", 9, ["CSC201"]),
  required("CPE405", "Microprocessor Technology and Micro-Programming", 3, "400L Harmattan", 9, ["CPE204"]),
  required("CPE409", "Microprocessor Design Laboratory", 2, "400L Harmattan", 9, ["CPE303"]),
  required("CSC415", "Operating Systems and System Programming", 3, "400L Harmattan", 9, ["CSC201"]),
  required("CVE401", "Technical Report Writing", 3, "400L Harmattan", 9),
  required("CPE400", "Student Industrial Work Experience Scheme III", 6, "400L Rain (SIWES)", 10),
  required("CPE503", "Individual Project I", 3, "500L Harmattan", 11),
  required("CSC505", "Object Oriented Modeling", 2, "500L Harmattan", 11, ["CSC302"]),
  required("CPE509", "Hardware Design Laboratory", 2, "500L Harmattan", 11, ["CPE405"]),
  required("CPE511", "Computer Based Real-Time System Design", 3, "500L Harmattan", 11),
  required("CPE517", "Digital Computer Networks", 3, "500L Harmattan", 11, ["CPE401"]),
  required("CPE521", "Modelling and Simulation", 2, "500L Harmattan", 11, ["CSC308"]),
  required("TPD501", "Industrial and Engineering Economics", 2, "500L Harmattan", 11),
  required("TPD503", "Production, Operations Management and Industrial Law", 2, "500L Harmattan", 11),
  required("CPE502", "Hardware Systems Studies", 3, "500L Rain", 12, ["CPE401"]),
  required("CPE504", "Individual Project II", 3, "500L Rain", 12, ["CPE503"]),
  required("CPE506", "Industrial Applications Studies", 2, "500L Rain", 12),
  required("CPE508", "Computer System Project Management", 3, "500L Rain", 12),
  required("CPE510", "Natural Language Processing and Applications", 3, "500L Rain", 12),
  required("TPD502", "Technology Policy", 2, "500L Rain", 12),
];

const COMPUTER_SCIENCE_ECONOMICS_COURSES: CurriculumCourse[] = [
  ...COMMON_COURSES,
  required("SSC102", "Required Social Science course", 2, "By graduation", 13),
  required("CSC201", "Computer Programming I", 3, "200L Harmattan", 3),
  required("CPE203", "Introduction to Digital Computer System I", 2, "200L Harmattan", 3),
  required("ECN201", "Principles of Economics I", 3, "200L Harmattan", 3),
  required("ECN203", "Introduction to Applied Economics I", 3, "200L Harmattan", 3),
  required("MTH201", "Mathematical Methods I", 4, "200L Harmattan", 3, ["MTH102"]),
  required("MEE203", "Engineering Drawing I", 2, "200L Harmattan", 3),
  required("CSC202", "Computer Programming II", 2, "200L Rain", 4, ["CSC201"]),
  required("CPE204", "Introduction to Digital Computer System II", 2, "200L Rain", 4, ["CPE203"]),
  required("CPE206", "Digital Laboratory I", 2, "200L Rain", 4),
  required("MTH202", "Mathematical Methods II", 4, "200L Rain", 4, ["MTH201"]),
  required("ECN202", "Principles of Economics II", 3, "200L Rain", 4, ["ECN201"]),
  required("ECN204", "Introduction to Applied Economics II", 3, "200L Rain", 4, ["ECN203"]),
  required("MEE204", "Engineering Drawing II", 2, "200L Rain", 4),
  required("CSC200", "Student Industrial Work Experience Scheme I", 3, "400L Rain (SIWES)", 10),
  required("CPE301", "Low Level Languages", 3, "300L Harmattan", 6, ["CSC201"]),
  required("CSC305", "Introduction to Database Systems", 3, "300L Harmattan", 6),
  required("CSC307", "Numerical Computation I", 2, "300L Harmattan", 6, ["MTH201"]),
  required("CSC311", "Introduction to Information Systems", 2, "300L Harmattan", 6),
  required("CSC315", "Data Structures and Analysis of Algorithms", 3, "300L Harmattan", 6),
  required("CSC317", "Automata Theory and Computability", 2, "300L Harmattan", 6),
  required("ECN301", "Microeconomic Theory I", 3, "300L Harmattan", 6),
  required("ECN313", "Statistical Theory I", 3, "300L Harmattan", 6),
  required("CSC302", "Object-Oriented Programming", 3, "300L Rain", 7, ["CPE301"]),
  required("CSC304", "Business and Commercial Programming", 2, "300L Rain", 7),
  required("CSC306", "Human-Computer Interaction Design", 3, "300L Rain", 7, ["CSC201"]),
  required("CSC308", "Numerical Computation II", 2, "300L Rain", 7, ["CSC307"]),
  required("CPE310", "Introduction to Agent Based Systems", 2, "300L Rain", 7),
  required("CSC312", "Systems Analysis and Design Methodologies", 2, "300L Rain", 7),
  required("CPE316", "Introduction to Artificial Intelligence", 2, "300L Rain", 7),
  required("ECN302", "Microeconomic Theory II", 3, "300L Rain", 7),
  required("ECN314", "Statistical Theory II", 3, "300L Rain", 7),
  required("CSC300", "Student Industrial Work Experience Scheme II", 3, "400L Rain (SIWES)", 10),
  required("CPE401", "Computer Architecture and Organization", 3, "400L Harmattan", 9, ["CPE204"]),
  required("CSC403", "Principles of Compilers", 3, "400L Harmattan", 9, ["CPE301"]),
  required("CPE405", "Microprocessor Technology and Micro-Programming", 3, "400L Harmattan", 9, ["CPE204"]),
  required("CSC407", "Techniques in Software Development", 2, "400L Harmattan", 9, ["CSC302"]),
  required("CSC415", "Operating Systems Principles", 3, "400L Harmattan", 9),
  required("CVE401", "Technical Report Writing", 3, "400L Harmattan", 9),
  required("ECN401", "Macroeconomic Theory II", 3, "400L Harmattan", 9),
  required("CSC400", "Engineering Valuation and SIWES III", 6, "400L Rain (SIWES)", 10),
  required("CSC501", "Introduction to Operations Research", 2, "500L Harmattan", 11),
  required("CSC503", "Individual Project I", 3, "500L Harmattan", 11),
  required("CSC505", "Object Oriented Modeling", 2, "500L Harmattan", 11),
  required("CSC515", "Database Design and Management", 2, "500L Harmattan", 11),
  required("CPE517", "Digital Computer Networks", 3, "500L Harmattan", 11, ["CPE401"]),
  required("CSC523", "Mathematical Programming", 2, "500L Harmattan", 11),
  required("TPD501", "Industrial and Engineering Economics", 2, "500L Harmattan", 11),
  required("ECN421", "Applied Economics Statistics", 3, "500L Harmattan", 11),
  required("CPE502", "Hardware Systems Studies", 3, "500L Rain", 12, ["CPE401"]),
  required("CSC504", "Individual Project II", 3, "500L Rain", 12, ["CSC503"]),
  required("CPE506", "Industrial Applications Studies", 2, "500L Rain", 12),
  required("CPE508", "Computer System Project Management", 3, "500L Rain", 12),
  required("CPE510", "Natural Language Processing and Application", 3, "500L Rain", 12),
  required("TPD502", "Technology Policy", 2, "500L Rain", 12),
];

const FINAL_CSC_HARMATTAN: CurriculumChoice = {
  id: "final-csc-harmattan",
  label: "500L Harmattan Computer Science option",
  unit: 2,
  semester: "500L Harmattan",
  order: 11,
  options: [
    option("CSC507", "Computers in Society", 2, "500L Harmattan", 11),
    option("CPE521", "Modelling and Simulation", 2, "500L Harmattan", 11),
    option("CSC513", "Principles and Applications of Data Mining", 2, "500L Harmattan", 11),
  ],
};

const FINAL_CSC_RAIN: CurriculumChoice = {
  id: "final-csc-rain",
  label: "500L Rain Computer Science options",
  unit: 4,
  semester: "500L Rain",
  order: 12,
  options: [
    option("CSC514", "Computer Graphics", 2, "500L Rain", 12),
    option("CSC520", "Expert Systems", 2, "500L Rain", 12),
    option("CSC522", "Information Storage and Retrieval", 2, "500L Rain", 12),
    option("CSC524", "Techniques in Data Analysis", 2, "500L Rain", 12),
  ],
};

export const PROGRAMMES: Record<ProgrammeId, ProgrammeCurriculum> = {
  "computer-science": {
    id: "computer-science",
    name: "B.Sc. (Hons) Computer Science",
    degreeUnit: 201,
    specialElectiveUnit: 12,
    gpaUnit: 189,
    additionalRequirements: [required("MTH-OPTION", "Additional approved Mathematics electives", 10, "By graduation", 13)],
    reconciliationUnit: 1,
    directEntryFoundationExemptionUnit: 30,
    requiredCourses: COMPUTER_SCIENCE_COURSES,
    choiceGroups: [
      FINAL_CSC_HARMATTAN,
      {
        id: "final-mathematics-harmattan",
        label: "500L Harmattan Mathematics option",
        unit: 2,
        semester: "500L Harmattan",
        order: 11,
        options: [
          option("MTH209", "Introduction to Real Analysis", 2, "500L Harmattan", 11),
          option("MTH210", "Mechanics", 2, "500L Harmattan", 11),
        ],
      },
      FINAL_CSC_RAIN,
    ],
  },
  "computer-science-economics": {
    id: "computer-science-economics",
    name: "B.Sc. (Hons) Computer Science with Economics",
    degreeUnit: 202,
    specialElectiveUnit: 12,
    gpaUnit: 190,
    additionalRequirements: [],
    reconciliationUnit: 2,
    directEntryFoundationExemptionUnit: 30,
    requiredCourses: COMPUTER_SCIENCE_ECONOMICS_COURSES,
    choiceGroups: [FINAL_CSC_HARMATTAN, FINAL_CSC_RAIN],
  },
  "computer-engineering": {
    id: "computer-engineering",
    name: "B.Sc. (Hons) Computer Engineering",
    degreeUnit: 207,
    specialElectiveUnit: 12,
    gpaUnit: 195,
    additionalRequirements: [],
    reconciliationUnit: 3,
    directEntryFoundationExemptionUnit: 30,
    requiredCourses: COMPUTER_ENGINEERING_COURSES,
    choiceGroups: [
      {
        id: "final-electronics-harmattan",
        label: "500L Harmattan Electronics option",
        unit: 3,
        semester: "500L Harmattan",
        order: 11,
        options: [
          option("EEE409", "Servomechanism and Control", 3, "500L Harmattan", 11),
          option("EEE411", "Communications Principles", 3, "500L Harmattan", 11),
        ],
      },
      FINAL_CSC_RAIN,
    ],
  },
};

export const PROGRAMME_IDS = Object.keys(PROGRAMMES) as ProgrammeId[];
